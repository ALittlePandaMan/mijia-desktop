//! CS2 rendezvous + direct UDP punch, ported from go2rtc PR #2264 (MIT).
//! Endpoint pool and opaque auth flags are observed protocol constants, not user input.
use super::{err, relay_table::TABLE, AppError, Result};
use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};
const SERVERS: [Ipv4Addr; 3] = [
    Ipv4Addr::new(47, 236, 156, 107),
    Ipv4Addr::new(47, 88, 30, 183),
    Ipv4Addr::new(47, 88, 30, 225),
];
pub(super) fn uid(id: &str) -> Result<[u8; 20]> {
    let parts: Vec<_> = id.split('-').collect();
    if parts.len() != 3
        || parts[0].is_empty()
        || parts[0].len() > 8
        || parts[2].is_empty()
        || parts[2].len() > 8
        || !id.is_ascii()
    {
        return Err(AppError::protocol());
    }
    let num = parts[1].parse::<u32>().map_err(|_| AppError::protocol())?;
    let mut out = [0u8; 20];
    out[..parts[0].len()].copy_from_slice(parts[0].as_bytes());
    out[8..12].copy_from_slice(&num.to_be_bytes());
    out[12..12 + parts[2].len()].copy_from_slice(parts[2].as_bytes());
    Ok(out)
}
fn packet(kind: u8, body: &[u8]) -> Vec<u8> {
    let mut out = vec![0xf1, kind];
    out.extend_from_slice(&(body.len() as u16).to_be_bytes());
    out.extend_from_slice(body);
    out
}
fn encrypt(data: &[u8]) -> Vec<u8> {
    let mut key = [0u8; 4];
    for b in b"SSD@cs2-network." {
        key[0] = key[0].wrapping_add(*b);
        key[1] = key[1].wrapping_sub(*b);
        key[2] = key[2].wrapping_add(*b / 3);
        key[3] ^= *b;
    }
    let mut prev = 0u8;
    data.iter()
        .map(|b| {
            prev = *b ^ TABLE[prev.wrapping_add(key[(prev & 3) as usize]) as usize];
            prev
        })
        .collect()
}
fn auth(uid: &[u8; 20], local: SocketAddr) -> Vec<u8> {
    let mut body = [0u8; 84];
    body[..20].copy_from_slice(uid);
    body[20..36].copy_from_slice(&[0, 0, 0, 6, 0, 20, 0, 1, 0, 136, 0, 0, 122, 0, 0, 0]);
    if let IpAddr::V4(ip) = local.ip() {
        for offset in [36, 52] {
            body[offset + 2..offset + 4].copy_from_slice(&local.port().to_le_bytes());
            body[offset + 4..offset + 8].copy_from_slice(&u32::from(ip).to_le_bytes());
        }
    }
    packet(0xf9, &encrypt(&body))
}
pub(super) fn connect(id: &str, stop: &AtomicBool) -> Result<(UdpSocket, SocketAddr)> {
    if stop.load(Ordering::Acquire) {
        return Err(AppError::stale());
    }
    let uid = uid(id)?;
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))
        .map_err(|_| err("videoNetwork", "无法建立远程视频连接。"))?;
    socket
        .set_read_timeout(Some(Duration::from_millis(200)))
        .map_err(|_| AppError::protocol())?;
    let port = socket
        .local_addr()
        .map_err(|_| AppError::protocol())?
        .port();
    let mut body = [0u8; 36];
    body[..20].copy_from_slice(&uid);
    body[22..26].copy_from_slice(&(crate::models::epoch_secs() as u32).to_be_bytes());
    let request = packet(0x20, &body);
    let mut requests = Vec::new();
    for ip in SERVERS {
        let route =
            UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).map_err(|_| AppError::protocol())?;
        let peer = SocketAddr::new(ip.into(), 32100);
        route.connect(peer).map_err(|_| AppError::protocol())?;
        let local = SocketAddr::new(
            route.local_addr().map_err(|_| AppError::protocol())?.ip(),
            port,
        );
        requests.push((peer, auth(&uid, local)));
    }
    let deadline = Instant::now() + Duration::from_secs(20);
    let mut last = Instant::now() - Duration::from_secs(3);
    let mut peer = None;
    let mut buf = [0u8; 2048];
    while Instant::now() < deadline && !stop.load(Ordering::Acquire) {
        if last.elapsed() >= Duration::from_secs(2) {
            for (address, auth) in &requests {
                let _ = socket.send_to(&request, address);
                let _ = socket.send_to(auth, address);
            }
            last = Instant::now();
        }
        if let Ok((len, from)) = socket.recv_from(&mut buf) {
            if len >= 12
                && buf[0] == 0xf1
                && buf[1] == 0x40
                && requests.iter().any(|(s, _)| s.ip() == from.ip())
            {
                let ip = Ipv4Addr::new(buf[11], buf[10], buf[9], buf[8]);
                let port = u16::from_le_bytes(buf[6..8].try_into().unwrap());
                if !ip.is_unspecified() && !ip.is_multicast() && !ip.is_loopback() && port > 0 {
                    peer = Some(SocketAddr::new(ip.into(), port));
                    break;
                }
            }
        }
    }
    let peer =
        peer.ok_or_else(|| err("videoRelayTimeout", "远程视频服务器未返回摄像机连接信息。"))?;
    let mut punch = packet(0x41, &uid);
    let deadline = Instant::now() + Duration::from_secs(15);
    last = Instant::now() - Duration::from_secs(2);
    while Instant::now() < deadline && !stop.load(Ordering::Acquire) {
        if last.elapsed() >= Duration::from_millis(500) {
            let _ = socket.send_to(&punch, peer);
            last = Instant::now();
        }
        if let Ok((len, from)) = socket.recv_from(&mut buf) {
            if from == peer && len >= 4 && buf[0] == 0xf1 {
                match buf[1] {
                    0x42 => return Ok((socket, peer)),
                    0x41 => punch = buf[..len].to_vec(),
                    _ => {}
                }
            }
        }
    }
    if stop.load(Ordering::Acquire) {
        return Err(AppError::stale());
    }
    Err(err("videoPunchTimeout", "摄像机未完成远程视频握手。"))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn identifiers_are_canonical_and_bounded() {
        assert_eq!(
            &uid("ABCDEF-123456-GHIJK").unwrap()[8..12],
            &123456u32.to_be_bytes()
        );
        assert!(uid("TOOLONGID-1-ABC").is_err());
        assert!(uid("A-4294967296-B").is_err());
    }
    #[test]
    fn auth_has_fixed_size_without_identifier_leak() {
        let p = auth(
            &uid("ABCDEF-123456-GHIJK").unwrap(),
            "192.168.1.2:1234".parse().unwrap(),
        );
        assert_eq!(p.len(), 88);
        assert_eq!(&p[..4], &[0xf1, 0xf9, 0, 84]);
        assert!(!p.windows(6).any(|s| s == b"ABCDEF"));
    }
}
