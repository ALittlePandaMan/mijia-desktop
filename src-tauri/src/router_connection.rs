//! Read-only local connection check corresponding to plugin 10148/11789.
//! SSIDs and adapter addresses never leave this module as diagnostics.
use crate::{models::Device, router, router_wifi::WifiReport};
use serde::Serialize;
use std::{net::Ipv4Addr, time::Duration};
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Protection {
    pub state: &'static str,
    pub protected_bands: Vec<usize>,
    pub reason: Option<String>,
}
impl Protection {
    pub fn unchecked() -> Self {
        Self {
            state: "notChecked",
            protected_bands: vec![],
            reason: None,
        }
    }
    fn unavailable() -> Self {
        Self {
            state: "unavailable",
            protected_bands: vec![],
            reason: Some("当前无线连接未能核对，关闭当前连接的保护暂不可用。".into()),
        }
    }
}
// No Debug/Serialize: local network identifiers are transient only.
struct Wireless {
    ssid: Vec<u8>,
    gateways: Vec<Ipv4Addr>,
}
/// Used only to protect this PC from Wi-Fi admission changes. Addresses never
/// cross IPC or enter diagnostics. An OS failure stays unknown, not an empty set.
pub(crate) async fn local_macs() -> Option<Vec<String>> {
    tokio::time::timeout(
        Duration::from_secs(2),
        tokio::task::spawn_blocking(platform::local_macs),
    )
    .await
    .ok()?
    .ok()?
    .ok()
}
fn matching_bands(ssid: &[u8], wifi: &WifiReport) -> Vec<usize> {
    if ssid.is_empty() {
        return vec![];
    }
    wifi.values
        .bands
        .iter()
        .enumerate()
        .filter_map(|(i, b)| (wifi.enabled[i] && b.ssid.as_bytes() == ssid).then_some(i))
        .collect()
}
fn local_gateway(ip: Ipv4Addr) -> bool {
    ip.is_private() || ip.is_link_local()
}
fn probe_url(ip: Ipv4Addr) -> Option<String> {
    local_gateway(ip).then(|| format!("http://{ip}/cgi-bin/luci/api/xqsystem/init_info"))
}
fn same_router(value: &serde_json::Value, expected: &str) -> bool {
    value["routerId"].as_str() == Some(expected)
}
async fn probe(client: &reqwest::Client, ip: Ipv4Addr, expected: &str) -> Option<bool> {
    let url = probe_url(ip)?;
    let mut response = client
        .get(url)
        .query(&[("deviceId", expected)])
        .send()
        .await
        .ok()?;
    if !response.status().is_success() || response.content_length().is_some_and(|n| n > 32768) {
        return None;
    }
    let mut body = vec![];
    while let Some(chunk) = response.chunk().await.ok()? {
        if body.len() + chunk.len() > 32768 {
            return None;
        }
        body.extend_from_slice(&chunk);
    }
    let value: serde_json::Value = serde_json::from_slice(&body).ok()?;
    value["routerId"].as_str()?;
    Some(same_router(&value, expected))
}
// For local management, wired connections also count. No addresses cross IPC.
pub(crate) async fn verified_gateway(device: &Device) -> Option<Ipv4Addr> {
    let rows = tokio::time::timeout(
        Duration::from_secs(2),
        tokio::task::spawn_blocking(platform::all_gateways),
    )
    .await
    .ok()?
    .ok()?
    .ok()?;
    let expected = router::gateway_id(device).ok()?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_millis(900))
        .build()
        .ok()?;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
    for ip in rows {
        if tokio::time::timeout_at(deadline, probe(&client, ip, expected))
            .await
            .ok()?
            == Some(true)
        {
            return Some(ip);
        }
    }
    None
}
pub async fn inspect(device: &Device, wifi: &WifiReport) -> Protection {
    let connections = match tokio::time::timeout(
        Duration::from_secs(2),
        tokio::task::spawn_blocking(platform::connections),
    )
    .await
    {
        Ok(Ok(Ok(rows))) => rows,
        _ => return Protection::unavailable(),
    };
    if connections.is_empty() {
        return Protection {
            state: "notWireless",
            protected_bands: vec![],
            reason: None,
        };
    }
    let candidates: Vec<_> = connections
        .into_iter()
        .filter_map(|r| {
            let bands = matching_bands(&r.ssid, wifi);
            (!bands.is_empty()).then_some((r.gateways, bands))
        })
        .collect();
    if candidates.is_empty() {
        return Protection {
            state: "otherNetwork",
            protected_bands: vec![],
            reason: None,
        };
    }
    let Ok(expected) = router::gateway_id(device) else {
        return Protection::unavailable();
    };
    let Ok(client) = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_millis(700))
        .timeout(Duration::from_millis(1500))
        .build()
    else {
        return Protection::unavailable();
    };
    let mut protected = vec![];
    let mut unknown = false;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
    'routers: for (gateways, bands) in candidates {
        if gateways.is_empty() {
            unknown = true;
        }
        for ip in gateways {
            let result = match tokio::time::timeout_at(deadline, probe(&client, ip, expected)).await
            {
                Ok(value) => value,
                Err(_) => {
                    unknown = true;
                    break 'routers;
                }
            };
            match result {
                Some(true) => {
                    for b in &bands {
                        if !protected.contains(b) {
                            protected.push(*b);
                        }
                    }
                }
                Some(false) => {}
                None => unknown = true,
            }
        }
    }
    if !protected.is_empty() {
        return Protection {
            state: "protected",
            protected_bands: protected,
            reason: None,
        };
    }
    if unknown {
        Protection::unavailable()
    } else {
        Protection {
            state: "otherRouter",
            protected_bands: vec![],
            reason: None,
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use super::Wireless;
    pub fn local_macs() -> Result<Vec<String>, ()> {
        Err(())
    }
    pub fn all_gateways() -> Result<Vec<std::net::Ipv4Addr>, ()> {
        Err(())
    }
    pub fn connections() -> Result<Vec<Wireless>, ()> {
        static READ: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _exclusive = READ.try_lock().map_err(|_| ())?;
        Err(())
    }
}

#[cfg(windows)]
mod platform {
    use super::Wireless;
    use std::{
        ffi::c_void,
        mem::{size_of, MaybeUninit},
        net::Ipv4Addr,
        ptr,
    };
    use windows_sys::Win32::{
        Foundation::{ERROR_BUFFER_OVERFLOW, HANDLE},
        NetworkManagement::{IpHelper::*, Ndis::NET_LUID_LH, WiFi::*},
        Networking::WinSock::{AF_INET, SOCKADDR_IN},
    };
    struct Handle(HANDLE);
    impl Drop for Handle {
        fn drop(&mut self) {
            unsafe {
                WlanCloseHandle(self.0, ptr::null());
            }
        }
    }
    struct Memory(*mut c_void);
    impl Drop for Memory {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    WlanFreeMemory(self.0);
                }
            }
        }
    }
    fn fits<T>(p: *const T, start: usize, bytes: usize) -> bool {
        let at = p as usize;
        !p.is_null()
            && at % std::mem::align_of::<T>() == 0
            && at >= start
            && at
                .checked_add(size_of::<T>())
                .is_some_and(|end| end <= start.saturating_add(bytes))
    }
    pub fn local_macs() -> Result<Vec<String>, ()> {
        let mut bytes = 15000_u32;
        for _ in 0..3 {
            if bytes > 1024 * 1024 {
                return Err(());
            }
            let mut buffer = vec![
                MaybeUninit::<IP_ADAPTER_ADDRESSES_LH>::uninit();
                (bytes as usize).div_ceil(size_of::<IP_ADAPTER_ADDRESSES_LH>())
            ];
            let start = buffer.as_mut_ptr().cast::<IP_ADAPTER_ADDRESSES_LH>();
            let allocated = buffer.len() * size_of::<IP_ADAPTER_ADDRESSES_LH>();
            let status = unsafe {
                GetAdaptersAddresses(
                    u32::from(AF_INET),
                    GAA_FLAG_SKIP_DNS_SERVER | GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST,
                    ptr::null(),
                    start,
                    &mut bytes,
                )
            };
            if status == ERROR_BUFFER_OVERFLOW {
                continue;
            }
            if status != 0 {
                return Err(());
            }
            let mut row = start;
            let mut count = 0;
            let mut result = vec![];
            while !row.is_null() {
                if count >= 256 || !fits(row, start as usize, allocated) {
                    return Err(());
                }
                count += 1;
                let adapter = unsafe { &*row };
                if adapter.PhysicalAddressLength == 6 {
                    let value = adapter.PhysicalAddress[..6]
                        .iter()
                        .map(|b| format!("{b:02x}"))
                        .collect::<Vec<_>>()
                        .join(":");
                    if !result.contains(&value) {
                        result.push(value);
                    }
                }
                row = adapter.Next;
            }
            return Ok(result);
        }
        Err(())
    }
    fn gateways(luid: Option<u64>) -> Result<Vec<Ipv4Addr>, ()> {
        let mut bytes = 15000_u32;
        for _ in 0..3 {
            if bytes > 1024 * 1024 {
                return Err(());
            }
            let elements = (bytes as usize).div_ceil(size_of::<IP_ADAPTER_ADDRESSES_LH>());
            let mut buffer = vec![MaybeUninit::<IP_ADAPTER_ADDRESSES_LH>::uninit(); elements];
            let start = buffer.as_mut_ptr().cast::<IP_ADAPTER_ADDRESSES_LH>();
            let allocated = buffer.len() * size_of::<IP_ADAPTER_ADDRESSES_LH>();
            let status = unsafe {
                GetAdaptersAddresses(
                    u32::from(AF_INET),
                    GAA_FLAG_INCLUDE_GATEWAYS
                        | GAA_FLAG_SKIP_DNS_SERVER
                        | GAA_FLAG_SKIP_ANYCAST
                        | GAA_FLAG_SKIP_MULTICAST,
                    ptr::null(),
                    start,
                    &mut bytes,
                )
            };
            if status == ERROR_BUFFER_OVERFLOW {
                continue;
            }
            if status != 0 {
                return Err(());
            }
            let mut adapter = start;
            let mut count = 0;
            let mut result = vec![];
            while !adapter.is_null() {
                if count >= 256 || !fits(adapter, start as usize, allocated) {
                    return Err(());
                }
                count += 1;
                let row = unsafe { &*adapter };
                if luid.is_none_or(|value| unsafe { row.Luid.Value } == value)
                    && row.OperStatus == 1
                {
                    let mut gateway = row.FirstGatewayAddress;
                    let mut gateway_count = 0;
                    while !gateway.is_null() {
                        if gateway_count >= 16 || !fits(gateway, start as usize, allocated) {
                            return Err(());
                        }
                        gateway_count += 1;
                        let g = unsafe { &*gateway };
                        let socket = g.Address.lpSockaddr.cast::<SOCKADDR_IN>();
                        if g.Address.iSockaddrLength >= size_of::<SOCKADDR_IN>() as i32
                            && fits(socket, start as usize, allocated)
                        {
                            let s = unsafe { &*socket };
                            if s.sin_family == AF_INET {
                                let a = unsafe { s.sin_addr.S_un.S_un_b };
                                let ip = Ipv4Addr::new(a.s_b1, a.s_b2, a.s_b3, a.s_b4);
                                if !result.contains(&ip) {
                                    result.push(ip);
                                }
                            }
                        }
                        gateway = g.Next;
                    }
                    if luid.is_some() {
                        return Ok(result);
                    }
                }
                adapter = row.Next;
            }
            return Ok(result);
        }
        Err(())
    }
    pub fn all_gateways() -> Result<Vec<Ipv4Addr>, ()> {
        static READ: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _exclusive = READ.try_lock().map_err(|_| ())?;
        gateways(None)
    }
    pub fn connections() -> Result<Vec<Wireless>, ()> {
        // A timed-out OS call may still be running on a blocking worker.
        static READ: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _exclusive = READ.try_lock().map_err(|_| ())?;
        let mut negotiated = 0;
        let mut raw = ptr::null_mut();
        if unsafe { WlanOpenHandle(2, ptr::null(), &mut negotiated, &mut raw) } != 0
            || raw.is_null()
        {
            return Err(());
        }
        let handle = Handle(raw);
        let mut list = ptr::null_mut();
        if unsafe { WlanEnumInterfaces(handle.0, ptr::null(), &mut list) } != 0 || list.is_null() {
            return Err(());
        }
        let _list = Memory(list.cast());
        let count = unsafe { (*list).dwNumberOfItems } as usize;
        if count > 256 {
            return Err(());
        }
        let first = unsafe { ptr::addr_of!((*list).InterfaceInfo).cast::<WLAN_INTERFACE_INFO>() };
        let mut result = vec![];
        for i in 0..count {
            // The API owns count contiguous entries until WlanFreeMemory.
            let row = unsafe { &*first.add(i) };
            if row.isState != wlan_interface_state_connected {
                continue;
            }
            let mut bytes = 0;
            let mut data = ptr::null_mut();
            let mut kind = 0;
            if unsafe {
                WlanQueryInterface(
                    handle.0,
                    &row.InterfaceGuid,
                    wlan_intf_opcode_current_connection,
                    ptr::null(),
                    &mut bytes,
                    &mut data,
                    &mut kind,
                )
            } != 0
                || data.is_null()
            {
                return Err(());
            }
            let _data = Memory(data);
            if (bytes as usize) < size_of::<WLAN_CONNECTION_ATTRIBUTES>() {
                return Err(());
            }
            let attr = unsafe { &*data.cast::<WLAN_CONNECTION_ATTRIBUTES>() };
            if attr.isState != wlan_interface_state_connected {
                continue;
            }
            let ssid = &attr.wlanAssociationAttributes.dot11Ssid;
            let length = ssid.uSSIDLength as usize;
            if length > 32 {
                return Err(());
            }
            let mut luid = NET_LUID_LH::default();
            if unsafe { ConvertInterfaceGuidToLuid(&row.InterfaceGuid, &mut luid) } != 0 {
                return Err(());
            }
            result.push(Wireless {
                ssid: ssid.ucSSID[..length].to_vec(),
                gateways: gateways(Some(unsafe { luid.Value }))?,
            });
        }
        Ok(result)
    }
    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn native_list_bounds_reject_null_misaligned_and_one_past_end() {
            let words = [0_u64; 4];
            let start = words.as_ptr() as usize;
            let bytes = std::mem::size_of_val(&words);
            assert!(fits(words.as_ptr(), start, bytes));
            assert!(!fits::<u64>(ptr::null(), start, bytes));
            assert!(!fits((start + 1) as *const u64, start, bytes));
            assert!(!fits((start + bytes) as *const u64, start, bytes));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn wifi() -> WifiReport {
        WifiReport {
            did: "fixture".into(),
            model: router::MODEL.into(),
            revision: "a".repeat(64),
            values: crate::router_wifi::WifiValues {
                merged: false,
                enabled: None,
                bands: vec![
                    crate::router_wifi::Names {
                        ssid: "fixture".into(),
                        password: "fixture-pass".into(),
                    },
                    crate::router_wifi::Names {
                        ssid: "fixture_5G".into(),
                        password: "fixture-pass".into(),
                    },
                ],
            },
            enabled: vec![true, true],
            encrypted: vec![true, true],
            can_merge: true,
            special_characters: true,
            write_reason: None,
            protection: None,
        }
    }
    #[test]
    fn ssids_match_exact_bytes_without_quote_stripping_or_case_folding() {
        let r = wifi();
        assert_eq!(matching_bands(b"fixture_5G", &r), vec![1]);
        assert!(matching_bands(b"FIXTURE", &r).is_empty());
        assert!(matching_bands(b"\"fixture\"", &r).is_empty());
        assert!(matching_bands(b"", &r).is_empty());
    }
    #[test]
    fn same_ssid_is_insufficient_without_verified_router_identity() {
        assert!(!same_router(
            &json!({"routerId":"other-router"}),
            "fixture-router"
        ));
        assert!(!same_router(&json!({"code":0}), "fixture-router"));
        assert!(same_router(
            &json!({"routerId":"fixture-router"}),
            "fixture-router"
        ));
    }
    #[test]
    fn probes_cannot_target_public_loopback_or_unspecified_addresses() {
        for ip in [
            Ipv4Addr::new(8, 8, 8, 8),
            Ipv4Addr::LOCALHOST,
            Ipv4Addr::UNSPECIFIED,
        ] {
            assert!(probe_url(ip).is_none());
        }
        assert!(probe_url(Ipv4Addr::new(192, 168, 31, 1))
            .unwrap()
            .ends_with("/cgi-bin/luci/api/xqsystem/init_info"));
    }
}
