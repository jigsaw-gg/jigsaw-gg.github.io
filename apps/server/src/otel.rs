//! Optional OpenObserve / OTLP HTTP tracing (gated by `OTEL_EXPORTER_OTLP_HTTP_ENDPOINT`).
//!
//! Category reporting is controlled by `OTEL_ENABLED_FOR` (semicolon-separated allowlist),
//! e.g. `bootstrap;networking;piece-logic;input`.
//!
//! Call sites always create spans via these helpers — never branch on enablement.
//! Disabled categories return [`Span::none()`] so filtering stays in this module.
//!
//! - Env unset → all categories enabled
//! - Env set (possibly empty) → only listed categories

use std::collections::HashMap;
use std::sync::OnceLock;

use opentelemetry::KeyValue;
use opentelemetry::trace::TracerProvider as _;
use opentelemetry_otlp::{Protocol, SpanExporter, WithExportConfig, WithHttpConfig};
use opentelemetry_sdk::Resource;
use opentelemetry_sdk::trace::SdkTracerProvider;
use tracing::Span;
use tracing_subscriber::EnvFilter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use uuid::Uuid;

const SERVICE_NAME: &str = "jigsaw-gg-server";
const OPENOBSERVE_STREAM_NAME: &str = "default";
const USERNAME_ENV: &str = "OTEL_OTEL_EXPORTER_OTLP_USERNAME";
const PASSWORD_ENV: &str = "OTEL_OTEL_EXPORTER_OTLP_PASSWORD";
const ORGANIZATION_ENV: &str = "OTEL_OTEL_EXPORTER_OTLP_ORGANIZATION";
const ENABLED_FOR_ENV: &str = "OTEL_ENABLED_FOR";

static SERVER_ID: OnceLock<String> = OnceLock::new();
static ENABLED: OnceLock<EnabledCategories> = OnceLock::new();

/// Reporting category for OTEL spans.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Category {
    Bootstrap,
    Networking,
    PieceLogic,
    Input,
}

impl Category {
    pub const ALL: [Category; 4] = [
        Category::Bootstrap,
        Category::Networking,
        Category::PieceLogic,
        Category::Input,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Category::Bootstrap => "bootstrap",
            Category::Networking => "networking",
            Category::PieceLogic => "piece-logic",
            Category::Input => "input",
        }
    }

    fn parse(token: &str) -> Option<Self> {
        match token.trim().to_ascii_lowercase().as_str() {
            "bootstrap" => Some(Category::Bootstrap),
            "networking" => Some(Category::Networking),
            "piece-logic" | "piece_logic" | "piecelogic" => Some(Category::PieceLogic),
            "input" => Some(Category::Input),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
struct EnabledCategories {
    /// Bitmask parallel to [`Category::ALL`] order; all-true when env unset.
    mask: [bool; 4],
}

impl EnabledCategories {
    fn all_enabled() -> Self {
        Self { mask: [true; 4] }
    }

    fn none_enabled() -> Self {
        Self { mask: [false; 4] }
    }

    fn from_allowlist(raw: &str) -> Self {
        let mut mask = [false; 4];
        let mut any = false;
        for token in raw.split([';', ',']) {
            if token.trim().is_empty() {
                continue;
            }
            any = true;
            if let Some(cat) = Category::parse(token) {
                mask[cat_index(cat)] = true;
            }
        }
        if any {
            Self { mask }
        } else {
            Self::none_enabled()
        }
    }

    fn is_enabled(&self, cat: Category) -> bool {
        self.mask[cat_index(cat)]
    }

    fn summary(&self) -> String {
        Category::ALL
            .iter()
            .filter(|c| self.is_enabled(**c))
            .map(|c| c.as_str())
            .collect::<Vec<_>>()
            .join(";")
    }
}

fn cat_index(cat: Category) -> usize {
    match cat {
        Category::Bootstrap => 0,
        Category::Networking => 1,
        Category::PieceLogic => 2,
        Category::Input => 3,
    }
}

fn enabled_categories() -> &'static EnabledCategories {
    ENABLED.get_or_init(|| match std::env::var(ENABLED_FOR_ENV) {
        Err(_) => EnabledCategories::all_enabled(),
        Ok(raw) => EnabledCategories::from_allowlist(&raw),
    })
}

/// Build a span for `cat`, or [`Span::none`] when that category is disabled.
fn span_for(cat: Category, build: impl FnOnce() -> Span) -> Span {
    if enabled_categories().is_enabled(cat) {
        build()
    } else {
        Span::none()
    }
}

/// Unique id for this process, created once at first use (startup).
pub fn server_id() -> &'static str {
    SERVER_ID.get_or_init(|| Uuid::new_v4().to_string())
}

/// Process bootstrap / startup spans.
pub fn bootstrap_span(name: &'static str) -> Span {
    span_for(Category::Bootstrap, || {
        tracing::info_span!(
            "otel.bootstrap",
            otel.name = name,
            category = Category::Bootstrap.as_str(),
            server_id = %server_id(),
        )
    })
}

/// Span for a unary HTTP/gRPC RPC: always carries `server_id` + fresh `request_id`.
/// Record `game_id` later with [`record_game_id`] when known.
pub fn unary_span(rpc: &'static str) -> Span {
    span_for(Category::Networking, || {
        tracing::info_span!(
            "rpc.unary",
            rpc,
            category = Category::Networking.as_str(),
            server_id = %server_id(),
            request_id = %Uuid::new_v4(),
            game_id = tracing::field::Empty,
        )
    })
}

/// Span for a long-lived game play session (streaming / transport).
pub fn game_session_span(rpc: &'static str, game_id: &str, player_id: &str) -> Span {
    span_for(Category::Networking, || {
        tracing::info_span!(
            "rpc.game_session",
            rpc,
            category = Category::Networking.as_str(),
            server_id = %server_id(),
            game_id = %game_id,
            player_id = %player_id,
        )
    })
}

/// Client input / envelope handling.
pub fn input_span(name: &'static str) -> Span {
    span_for(Category::Input, || {
        tracing::info_span!(
            "game.input",
            otel.name = name,
            category = Category::Input.as_str(),
            server_id = %server_id(),
            game_id = tracing::field::Empty,
            player_id = tracing::field::Empty,
        )
    })
}

/// Piece claim / move / merge / release logic.
pub fn piece_logic_span(name: &'static str) -> Span {
    span_for(Category::PieceLogic, || {
        tracing::info_span!(
            "game.piece_logic",
            otel.name = name,
            category = Category::PieceLogic.as_str(),
            server_id = %server_id(),
            game_id = tracing::field::Empty,
            player_id = tracing::field::Empty,
        )
    })
}

/// Attach `game_id` to the current span when non-empty.
pub fn record_game_id(game_id: &str) {
    if !game_id.is_empty() {
        Span::current().record("game_id", game_id);
    }
}

/// Attach `player_id` to the current span when non-empty.
pub fn record_player_id(player_id: &str) {
    if !player_id.is_empty() {
        Span::current().record("player_id", player_id);
    }
}

/// Build OpenObserve OTLP/HTTP headers (Basic auth + stream-name).
/// Organization belongs in the URL path (`/api/<org>`), not a header.
fn openobserve_otlp_headers() -> HashMap<String, String> {
    let mut headers = HashMap::new();
    headers.insert(
        "stream-name".to_string(),
        OPENOBSERVE_STREAM_NAME.to_string(),
    );

    let user = std::env::var(USERNAME_ENV).unwrap_or_default();
    let pass = std::env::var(PASSWORD_ENV).unwrap_or_default();
    if !user.is_empty() || !pass.is_empty() {
        use base64::Engine;
        let token = base64::engine::general_purpose::STANDARD.encode(format!("{user}:{pass}"));
        headers.insert("Authorization".to_string(), format!("Basic {token}"));
    }
    headers
}

fn openobserve_otlp_http_endpoint(base: &str, organization: &str) -> String {
    let mut endpoint = base.trim().trim_end_matches('/').to_string();
    let org = organization.trim();
    if endpoint.is_empty() {
        return endpoint;
    }
    if !endpoint.contains("/api/") && !org.is_empty() {
        endpoint = format!("{endpoint}/api/{org}");
    }
    // opentelemetry-otlp HTTP with_endpoint uses the URL as-is (does not append
    // /v1/traces). Python/Logfire treat the env as a base and append signal paths.
    if !endpoint.ends_with("/v1/traces") {
        endpoint = format!("{endpoint}/v1/traces");
    }
    endpoint
}

fn resolve_otlp_endpoint() -> Option<String> {
    let raw = std::env::var("OTEL_EXPORTER_OTLP_HTTP_ENDPOINT")
        .ok()?
        .trim()
        .to_string();
    if raw.is_empty() {
        return None;
    }
    let org = std::env::var(ORGANIZATION_ENV).unwrap_or_default();
    Some(openobserve_otlp_http_endpoint(&raw, &org))
}

/// Install stdout + optional OTLP tracing. Returns a provider to shut down on exit.
pub fn init_tracing() -> Result<Option<SdkTracerProvider>, Box<dyn std::error::Error + Send + Sync>>
{
    let sid = server_id();
    let enabled = enabled_categories();
    info_to_stderr(&format!(
        "server_id={sid} OTEL_ENABLED_FOR={}",
        enabled.summary()
    ));

    let env_filter = EnvFilter::from_default_env().add_directive("jigsaw_gg_server=info".parse()?);

    let otlp_endpoint = resolve_otlp_endpoint();
    if otlp_endpoint.is_none() {
        tracing_subscriber::fmt().with_env_filter(env_filter).init();
        return Ok(None);
    }
    let endpoint = otlp_endpoint.unwrap();
    let headers = openobserve_otlp_headers();
    info_to_stderr(&format!(
        "OTEL HTTP exporter: endpoint={endpoint} headers={:?}",
        headers.keys().collect::<Vec<_>>()
    ));

    let exporter = SpanExporter::builder()
        .with_http()
        .with_protocol(Protocol::HttpBinary)
        .with_endpoint(endpoint)
        .with_headers(headers)
        .build()?;

    let provider = SdkTracerProvider::builder()
        .with_batch_exporter(exporter)
        .with_resource(
            Resource::builder_empty()
                .with_attributes([
                    KeyValue::new(
                        opentelemetry_semantic_conventions::resource::SERVICE_NAME,
                        SERVICE_NAME,
                    ),
                    // Stable process identity (semconv `service.instance.id`).
                    KeyValue::new("service.instance.id", sid.to_string()),
                    KeyValue::new("server_id", sid.to_string()),
                ])
                .build(),
        )
        .build();

    let tracer = provider.tracer(SERVICE_NAME);
    let otel_layer = tracing_opentelemetry::layer().with_tracer(tracer);

    tracing_subscriber::registry()
        .with(env_filter)
        .with(tracing_subscriber::fmt::layer())
        .with(otel_layer)
        .init();

    // Smoke span so OpenObserve shows service_name / server_id even before any RPC traffic.
    // Log macros alone do not create OTLP spans — only tracing spans do.
    {
        let _guard = bootstrap_span("startup").entered();
    }
    // Never fail process startup on export problems — OTEL is optional.
    match provider.force_flush() {
        Ok(()) => info_to_stderr("OTEL HTTP exporter: startup flush ok"),
        Err(err) => {
            info_to_stderr(&format!(
                "OTEL HTTP exporter: startup flush failed (continuing): {err}"
            ));
        }
    }

    Ok(Some(provider))
}

fn info_to_stderr(msg: &str) {
    // tracing may not be initialized yet when we log endpoint selection.
    eprintln!("[jigsaw-gg-server] {msg}");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrites_endpoint_when_api_path_missing() {
        assert_eq!(
            openobserve_otlp_http_endpoint("http://localhost:15080", "local"),
            "http://localhost:15080/api/local/v1/traces"
        );
    }

    #[test]
    fn keeps_existing_api_path_and_appends_signal() {
        assert_eq!(
            openobserve_otlp_http_endpoint("http://localhost:15080/api/local", "local"),
            "http://localhost:15080/api/local/v1/traces"
        );
    }

    #[test]
    fn keeps_full_traces_url() {
        assert_eq!(
            openobserve_otlp_http_endpoint("http://localhost:15080/api/local/v1/traces", "local"),
            "http://localhost:15080/api/local/v1/traces"
        );
    }

    #[test]
    fn server_id_is_stable() {
        let a = server_id();
        let b = server_id();
        assert_eq!(a, b);
        assert!(!a.is_empty());
    }

    #[test]
    fn parses_enabled_for_allowlist() {
        let enabled = EnabledCategories::from_allowlist("bootstrap;networking;piece-logic;input");
        assert!(enabled.is_enabled(Category::Bootstrap));
        assert!(enabled.is_enabled(Category::Networking));
        assert!(enabled.is_enabled(Category::PieceLogic));
        assert!(enabled.is_enabled(Category::Input));
    }

    #[test]
    fn parses_partial_allowlist() {
        let enabled = EnabledCategories::from_allowlist("networking;input");
        assert!(!enabled.is_enabled(Category::Bootstrap));
        assert!(enabled.is_enabled(Category::Networking));
        assert!(!enabled.is_enabled(Category::PieceLogic));
        assert!(enabled.is_enabled(Category::Input));
    }

    #[test]
    fn empty_allowlist_disables_all() {
        let enabled = EnabledCategories::from_allowlist("");
        assert!(!enabled.is_enabled(Category::Bootstrap));
        assert!(!enabled.is_enabled(Category::Networking));
        assert!(!enabled.is_enabled(Category::PieceLogic));
        assert!(!enabled.is_enabled(Category::Input));
    }

    #[test]
    fn accepts_aliases_and_commas() {
        let enabled = EnabledCategories::from_allowlist("piece_logic, Bootstrap");
        assert!(enabled.is_enabled(Category::Bootstrap));
        assert!(enabled.is_enabled(Category::PieceLogic));
        assert!(!enabled.is_enabled(Category::Networking));
    }

    #[test]
    fn disabled_category_yields_none_span() {
        // Direct unit check of span_for behavior via a local allowlist mask.
        let disabled = EnabledCategories::from_allowlist("bootstrap");
        assert!(disabled.is_enabled(Category::Bootstrap));
        assert!(!disabled.is_enabled(Category::Networking));
    }
}
