use keyring::Entry;

const SERVICE: &str = "com.lensquery.desktop";

pub fn set(provider_id: &str, secret: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE, provider_id)
        .map_err(|error| format!("无法访问系统凭据保险库: {error}"))?;
    entry
        .set_password(secret)
        .map_err(|error| format!("无法把密钥保存到系统凭据保险库: {error}"))
}
