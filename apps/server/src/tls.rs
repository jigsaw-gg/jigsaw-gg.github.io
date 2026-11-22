use anyhow::{Context, Result, bail};
use rcgen::{CertificateParams, DistinguishedName, DnType, KeyPair, SanType};
use std::fs;
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use tracing::info;

#[derive(Clone)]
pub struct TlsMaterial {
    pub cert_path: PathBuf,
    pub key_path: PathBuf,
}

/// Resolve TLS material for WebTransport.
///
/// Priority:
/// 1. Explicit `cert_file` + `key_file` (both required if either is set)
/// 2. Existing `localhost+1.pem` / `localhost+1-key.pem` in `cert_dir` (mkcert)
/// 3. Existing `cert.pem` / `key.pem` in `cert_dir`
/// 4. Generate self-signed `cert.pem` / `key.pem` in `cert_dir`
pub fn ensure_dev_certs(
    cert_dir: &Path,
    public_host: &str,
    cert_file: Option<&Path>,
    key_file: Option<&Path>,
) -> Result<TlsMaterial> {
    match (cert_file, key_file) {
        (Some(cert_path), Some(key_path)) => {
            if !cert_path.exists() {
                bail!("CERT_FILE does not exist: {}", cert_path.display());
            }
            if !key_path.exists() {
                bail!("KEY_FILE does not exist: {}", key_path.display());
            }
            info!(
                cert = %cert_path.display(),
                key = %key_path.display(),
                "using configured TLS certificate"
            );
            return Ok(TlsMaterial {
                cert_path: cert_path.to_path_buf(),
                key_path: key_path.to_path_buf(),
            });
        }
        (None, None) => {}
        _ => bail!("CERT_FILE and KEY_FILE must both be set, or neither"),
    }

    fs::create_dir_all(cert_dir).context("create cert directory")?;

    let mkcert_cert = cert_dir.join("localhost+1.pem");
    let mkcert_key = cert_dir.join("localhost+1-key.pem");
    if mkcert_cert.exists() && mkcert_key.exists() {
        info!(
            cert = %mkcert_cert.display(),
            key = %mkcert_key.display(),
            "using mkcert TLS certificate"
        );
        return Ok(TlsMaterial {
            cert_path: mkcert_cert,
            key_path: mkcert_key,
        });
    }

    let cert_path = cert_dir.join("cert.pem");
    let key_path = cert_dir.join("key.pem");

    if cert_path.exists() && key_path.exists() {
        return Ok(TlsMaterial {
            cert_path,
            key_path,
        });
    }

    info!(
        dir = %cert_dir.display(),
        host = %public_host,
        "generating self-signed TLS certificate"
    );

    let mut sans = vec![
        SanType::DnsName("localhost".try_into()?),
        SanType::IpAddress(IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)),
    ];
    match IpAddr::from_str(public_host) {
        Ok(ip) => {
            if ip != IpAddr::V4(std::net::Ipv4Addr::LOCALHOST) {
                sans.push(SanType::IpAddress(ip));
            }
        }
        Err(_) if public_host != "localhost" => {
            sans.insert(0, SanType::DnsName(public_host.try_into()?));
        }
        Err(_) => {}
    }

    let mut params = CertificateParams::default();
    params.distinguished_name = DistinguishedName::new();
    params
        .distinguished_name
        .push(DnType::CommonName, "jigsaw-gg-server-dev");
    params.subject_alt_names = sans;

    let key_pair = KeyPair::generate()?;
    let cert = params.self_signed(&key_pair)?;

    fs::write(&cert_path, cert.pem())?;
    fs::write(&key_path, key_pair.serialize_pem())?;

    Ok(TlsMaterial {
        cert_path,
        key_path,
    })
}
