use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Worker error: {0}")]
    Worker(#[from] worker::Error),

    #[error("Database query failed")]
    Database,

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Invalid request: {0}")]
    BadRequest(String),

    #[error("Unauthorized: {0}")]
    Unauthorized(String),

    #[error("Too many requests: {0}")]
    TooManyRequests(String),

    #[error("Cryptography error: {0}")]
    Crypto(String),

    #[error("Internal server error")]
    Internal,

    #[error("Two factor authentication required")]
    TwoFactorRequired(Value),

    #[error("API error response")]
    ApiJson { status: StatusCode, body: Value },
}

impl AppError {
    pub fn api_json(status: StatusCode, body: Value) -> Self {
        Self::ApiJson { status, body }
    }

    pub fn send_access_password_required() -> Self {
        Self::send_access_error(
            StatusCode::BAD_REQUEST,
            "invalid_request",
            "password_hash_b64_required",
        )
    }

    pub fn send_access_invalid() -> Self {
        Self::send_access_error(StatusCode::NOT_FOUND, "invalid_grant", "send_id_invalid")
    }

    pub fn send_access_password_invalid() -> Self {
        Self::send_access_error(
            StatusCode::NOT_FOUND,
            "invalid_grant",
            "password_hash_b64_invalid",
        )
    }

    fn send_access_error(status: StatusCode, error: &str, send_access_error_type: &str) -> Self {
        Self::api_json(
            status,
            json!({
                "kind": "expected_server",
                "error": error,
                "send_access_error_type": send_access_error_type,
            }),
        )
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        match self {
            AppError::ApiJson { status, body } => (status, Json(body)).into_response(),
            AppError::TwoFactorRequired(json_body) => {
                // Return 400 Bad Request with the 2FA required JSON response as expected by clients
                (StatusCode::BAD_REQUEST, Json(json_body)).into_response()
            }
            other => {
                let (status, error_message) = match other {
                    AppError::Worker(e) => (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Worker error: {}", e),
                    ),
                    AppError::Database => (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Database error".to_string(),
                    ),
                    AppError::NotFound(msg) => (StatusCode::NOT_FOUND, msg),
                    AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg),
                    AppError::Unauthorized(msg) => (StatusCode::UNAUTHORIZED, msg),
                    AppError::TooManyRequests(msg) => (StatusCode::TOO_MANY_REQUESTS, msg),
                    AppError::Crypto(msg) => (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Crypto error: {}", msg),
                    ),
                    AppError::Internal => (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Internal server error".to_string(),
                    ),
                    AppError::TwoFactorRequired(_) | AppError::ApiJson { .. } => unreachable!(),
                };

                // Bitwarden 客户端只认 `message`。
                // `BaseResponse.getResponseProperty` 依次尝试 Message → message → MESSAGE,
                // 从不读 `error`; 缺少 `message` 时前端一律回退到通用文案
                // 「发生意外错误。」, 真实原因被彻底吞掉。
                // 这里同时输出两个键: `message` 给客户端, `error` 保持向后兼容。
                let body = Json(json!({
                    "error": error_message.clone(),
                    "message": error_message,
                }));
                (status, body).into_response()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_send_access_error(
        app_error: AppError,
        expected_status: StatusCode,
        expected_error: &str,
        expected_type: &str,
    ) {
        let AppError::ApiJson { status, body } = app_error else {
            panic!("expected API JSON error");
        };

        assert_eq!(status, expected_status);
        assert_eq!(
            body,
            json!({
                "kind": "expected_server",
                "error": expected_error,
                "send_access_error_type": expected_type,
            })
        );
    }

    #[test]
    fn send_access_password_required_matches_client_contract() {
        assert_send_access_error(
            AppError::send_access_password_required(),
            StatusCode::BAD_REQUEST,
            "invalid_request",
            "password_hash_b64_required",
        );
    }

    #[test]
    fn send_access_grant_failures_match_client_contract() {
        assert_send_access_error(
            AppError::send_access_invalid(),
            StatusCode::NOT_FOUND,
            "invalid_grant",
            "send_id_invalid",
        );
        assert_send_access_error(
            AppError::send_access_password_invalid(),
            StatusCode::NOT_FOUND,
            "invalid_grant",
            "password_hash_b64_invalid",
        );
    }
}
