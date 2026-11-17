//! Local MCP secrets never share the Xiaomi credential entry.
use crate::{app_settings::storage, error::Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
pub fn access_key() -> Result<String> {
    let entry =
        keyring::Entry::new("io.mijiadesktop.client.mcp.v1", "access-key").map_err(storage)?;
    match entry.get_password() {
        Ok(key) => Ok(key),
        Err(keyring::Error::NoEntry) => rotate_key(),
        Err(e) => Err(storage(e)),
    }
}
pub fn rotate_key() -> Result<String> {
    let key = URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>());
    keyring::Entry::new("io.mijiadesktop.client.mcp.v1", "access-key")
        .map_err(storage)?
        .set_password(&key)
        .map_err(storage)?;
    Ok(key)
}
