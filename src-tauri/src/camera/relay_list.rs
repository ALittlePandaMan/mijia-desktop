//! Original Rust code implementing published CS2 wire facts:
//! https://github.com/eugeneRover/micam#6-cs2-relay-handshake.
//! No Java source or runtime is distributed. Endpoints come from the signed cloud.
use super::{err, AppError, Result};
use std::{
    collections::HashMap,
    net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};
fn global(ip: Ipv4Addr) -> bool {
    !ip.is_private()
        && !ip.is_loopback()
        && !ip.is_multicast()
        && !ip.is_broadcast()
        && !ip.is_unspecified()
        && !ip.is_link_local()
}
pub(super) fn servers(raw: &str) -> Vec<Ipv4Addr> {
    const LUT: [u8; 54] = [
        0x49, 0x59, 0x43, 0x3d, 0xb5, 0xbf, 0x6d, 0xa3, 0x47, 0x53, 0x4f, 0x61, 0x65, 0xe3, 0x71,
        0xe9, 0x67, 0x7f, 0x02, 0x03, 0x0b, 0xad, 0xb3, 0x89, 0x2b, 0x2f, 0x35, 0xc1, 0x6b, 0x8b,
        0x95, 0x97, 0x11, 0xe5, 0xa7, 0x0d, 0xef, 0xf1, 0x05, 0x07, 0x83, 0xfb, 0x9d, 0x3b, 0xc5,
        0xc7, 0x13, 0x17, 0x1d, 0x1f, 0x25, 0x29, 0xd3, 0xdf,
    ];
    let input = raw.split(':').next().unwrap_or("").as_bytes();
    if input.is_empty()
        || input.len() > 2048
        || input.len() % 2 != 0
        || !input.iter().all(|b| (b'A'..=b'P').contains(b))
    {
        return vec![];
    }
    let mut running = 0x39;
    let mut bytes = Vec::new();
    for (i, pair) in input.chunks_exact(2).enumerate() {
        let b = running ^ LUT[i % 54] ^ ((pair[0] - b'A') * 16 + (pair[1] - b'A'));
        bytes.push(b);
        running ^= b;
    }
    String::from_utf8(bytes)
        .ok()
        .map(|s| {
            s.split(',')
                .filter_map(|s| s.trim().parse::<Ipv4Addr>().ok())
                .filter(|ip| global(*ip))
                .take(16)
                .collect()
        })
        .unwrap_or_default()
}
fn pack(kind: u8, body: &[u8]) -> Vec<u8> {
    let mut p = vec![0xf1, kind];
    p.extend_from_slice(&(body.len() as u16).to_be_bytes());
    p.extend_from_slice(body);
    p
}
fn address(ip: Ipv4Addr, port: u16) -> [u8; 16] {
    let mut out = [0u8; 16];
    out[1] = 2;
    out[2..4].copy_from_slice(&port.to_le_bytes());
    out[4..8].copy_from_slice(&u32::from(ip).to_le_bytes());
    out
}
fn decode(data: &[u8]) -> Option<SocketAddr> {
    if data.len() < 16 {
        return None;
    }
    let ip = Ipv4Addr::new(data[7], data[6], data[5], data[4]);
    let port = u16::from_le_bytes([data[2], data[3]]);
    (global(ip) && port > 0).then_some(SocketAddr::new(ip.into(), port))
}
fn receive(
    socket: &UdpSocket,
    deadline: Instant,
    stop: &AtomicBool,
) -> Option<(u8, Vec<u8>, SocketAddr)> {
    let mut buffer = [0u8; 2048];
    while Instant::now() < deadline && !stop.load(Ordering::Acquire) {
        if let Ok((len, from)) = socket.recv_from(&mut buffer) {
            if len >= 4
                && buffer[0] == 0xf1
                && u16::from_be_bytes([buffer[2], buffer[3]]) as usize == len - 4
            {
                return Some((buffer[1], buffer[4..len].to_vec(), from));
            }
        }
    }
    None
}
fn register_candidate(socket: &UdpSocket, relay: SocketAddr, token: &[u8; 4], uid: &[u8; 20]) {
    let mut registration = token.to_vec();
    registration.extend_from_slice(uid);
    registration.extend_from_slice(&[0; 4]);
    for _ in 0..4 {
        let _ = socket.send_to(&pack(0x83, &registration), relay);
    }
}
pub(super) fn connect(
    id: &str,
    provisioned: &[Ipv4Addr],
    stop: &AtomicBool,
) -> Result<(UdpSocket, SocketAddr)> {
    let mut last = AppError::protocol();
    for _ in 0..3 {
        if stop.load(Ordering::Acquire) {
            return Err(AppError::stale());
        }
        match attempt(id, provisioned, stop) {
            Ok(connection) => return Ok(connection),
            Err(error) => last = error,
        }
    }
    Err(last)
}
fn attempt(
    id: &str,
    provisioned: &[Ipv4Addr],
    stop: &AtomicBool,
) -> Result<(UdpSocket, SocketAddr)> {
    let uid = super::relay::uid(id)?;
    let fallback = [
        Ipv4Addr::new(47, 236, 156, 107),
        Ipv4Addr::new(47, 88, 30, 183),
        Ipv4Addr::new(47, 88, 30, 225),
    ];
    let servers = if provisioned.is_empty() {
        &fallback[..]
    } else {
        provisioned
    };
    if stop.load(Ordering::Acquire) {
        return Err(AppError::stale());
    }
    let route = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).map_err(|_| AppError::protocol())?;
    route
        .connect((servers[0], 32100))
        .map_err(|_| AppError::protocol())?;
    let local = route.local_addr().map_err(|_| AppError::protocol())?.ip();
    let socket =
        UdpSocket::bind((local, 0)).map_err(|_| err("videoNetwork", "无法建立视频中继连接。"))?;
    socket
        .set_read_timeout(Some(Duration::from_millis(150)))
        .map_err(|_| AppError::protocol())?;
    for server in servers {
        let _ = socket.send_to(&pack(0x67, &uid), (*server, 32100));
    }
    let mut candidates: HashMap<SocketAddr, Vec<[u8; 4]>> = HashMap::new();
    let deadline = Instant::now() + Duration::from_millis(10500);
    let discovery_deadline = Instant::now() + Duration::from_millis(2500);
    let mut resend = Instant::now();
    let mut chosen = None;
    while Instant::now() < deadline && !stop.load(Ordering::Acquire) {
        if candidates.is_empty() && Instant::now() >= discovery_deadline {
            break;
        }
        if Instant::now() >= resend {
            if candidates.is_empty() {
                for server in servers {
                    let _ = socket.send_to(&pack(0x67, &uid), (*server, 32100));
                }
            }
            for (relay, tokens) in &candidates {
                for token in tokens {
                    register_candidate(&socket, *relay, token, &uid);
                }
                let _ = socket.send_to(&pack(0x70, &[]), relay);
            }
            resend = Instant::now() + Duration::from_millis(750);
        }
        let receive_deadline = if candidates.is_empty() {
            deadline.min(resend).min(discovery_deadline)
        } else {
            deadline.min(resend)
        };
        let Some((kind, body, from)) = receive(&socket, receive_deadline, stop) else {
            continue;
        };
        if kind == 0x82 && body.len() >= 20 && matches!(from.ip(),IpAddr::V4(ip) if global(ip)) {
            if let Some(address) = decode(&body[..16]) {
                if candidates.len() >= 32 && !candidates.contains_key(&address) {
                    continue;
                }
                let token = body[16..20].try_into().unwrap();
                let tokens = candidates.entry(address).or_default();
                if tokens.len() < 16 && !tokens.contains(&token) {
                    tokens.push(token);
                    register_candidate(&socket, address, &token, &uid);
                    let _ = socket.send_to(&pack(0x70, &[]), address);
                }
            }
        } else if kind == 0x71
            && !candidates.is_empty()
            && matches!(from.ip(),IpAddr::V4(ip) if global(ip))
        {
            chosen = Some(SocketAddr::new(from.ip(), 25000));
            break;
        }
    }
    if stop.load(Ordering::Acquire) {
        return Err(AppError::stale());
    }
    if candidates.is_empty() {
        return Err(err(
            "videoRelayDiscovery",
            "小米中继服务器未返回摄像机候选连接。",
        ));
    }
    let chosen = chosen.ok_or_else(|| err("videoRelayRegistration", "视频中继未确认连接登记。"))?;
    let mut session = None;
    for _ in 0..4 {
        let _ = socket.send_to(&pack(0x72, &[]), chosen);
        let deadline = Instant::now() + Duration::from_secs(2);
        while let Some((kind, body, from)) = receive(&socket, deadline, stop) {
            if kind == 0x73 && body.len() >= 6 && matches!(from.ip(),IpAddr::V4(ip) if global(ip)) {
                let port = u16::from_be_bytes([body[4], body[5]]);
                if port > 0 {
                    session = Some((
                        SocketAddr::new(chosen.ip(), port),
                        <[u8; 4]>::try_from(&body[..4]).unwrap(),
                    ));
                    break;
                }
            }
        }
        if session.is_some() {
            break;
        }
    }
    let (peer, token) =
        session.ok_or_else(|| err("videoRelayAllocation", "视频中继未分配会话端口。"))?;
    let IpAddr::V4(ip) = peer.ip() else {
        return Err(AppError::protocol());
    };
    let mut request = uid.to_vec();
    request.extend_from_slice(&address(ip, peer.port()));
    request.extend_from_slice(&token);
    let mut register = token.to_vec();
    register.extend_from_slice(&uid);
    register.extend_from_slice(&[0; 4]);
    for _ in 0..6 {
        if stop.load(Ordering::Acquire) {
            return Err(AppError::stale());
        }
        for server in servers {
            let _ = socket.send_to(&pack(0x80, &request), (*server, 32100));
        }
        for _ in 0..24 {
            let _ = socket.send_to(&pack(0x83, &register), peer);
        }
        let deadline = Instant::now() + Duration::from_secs(2);
        while let Some((kind, _, from)) = receive(&socket, deadline, stop) {
            if kind == 0x84 && from.ip() == peer.ip() {
                return Ok((socket, peer));
            }
        }
    }
    Err(err("videoRelayJoin", "摄像机未加入远程视频会话。"))
}
pub(super) fn link_reply(body: &[u8], local: SocketAddr) -> Option<Vec<u8>> {
    if body.len() < 88 || body[0] != 0xa1 || body[1] != 1 {
        return None;
    }
    let IpAddr::V4(ip) = local.ip() else {
        return None;
    };
    let mut out = body.to_vec();
    out[1] = 2;
    out[56..60].copy_from_slice(&[0xfe, 0xff, 0xff, 0xff]);
    for i in 0..4 {
        out[60 + i] = body[7 - i];
    }
    out[64..80].copy_from_slice(&address(ip, local.port()));
    out[80..82].copy_from_slice(&[2, 0]);
    out[82..84].copy_from_slice(&u16::from_le_bytes([body[42], body[43]]).to_be_bytes());
    out[84..88].copy_from_slice(&[body[47], body[46], body[45], body[44]]);
    Some(pack(0x28, &out))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn discovered_token_is_registered_immediately_with_original_wire_bytes() {
        let receiver = UdpSocket::bind("127.0.0.1:0").unwrap();
        receiver
            .set_read_timeout(Some(Duration::from_millis(300)))
            .unwrap();
        let sender = UdpSocket::bind("127.0.0.1:0").unwrap();
        let uid = [7; 20];
        let token = [1, 2, 3, 4];
        register_candidate(&sender, receiver.local_addr().unwrap(), &token, &uid);
        for _ in 0..4 {
            let mut bytes = [0; 64];
            let (len, _) = receiver.recv_from(&mut bytes).unwrap();
            assert_eq!(len, 32);
            assert_eq!(&bytes[..4], &[0xf1, 0x83, 0, 28]);
            assert_eq!(&bytes[4..8], &token);
            assert_eq!(&bytes[8..28], &uid);
            assert_eq!(&bytes[28..32], &[0; 4]);
        }
    }
    #[test]
    fn rejects_malformed_or_private_relay_endpoints() {
        for raw in ["", "AA:A", "!!!!", "A", "PPPPPPPPPPPPPPPPPPPP"] {
            assert!(servers(raw).is_empty());
        }
        assert!(decode(&address(Ipv4Addr::LOCALHOST, 32100)).is_none());
        assert_eq!(
            decode(&address(Ipv4Addr::new(47, 88, 30, 183), 32100))
                .unwrap()
                .port(),
            32100
        );
    }
    #[test]
    fn linking_preserves_identity_and_external_address() {
        let mut p = [0u8; 88];
        p[0] = 0xa1;
        p[1] = 1;
        p[4..8].copy_from_slice(&[1, 2, 3, 4]);
        p[40..56].copy_from_slice(&address(Ipv4Addr::new(1, 2, 3, 4), 50000));
        let reply = link_reply(&p, "192.168.1.2:1234".parse().unwrap()).unwrap();
        assert_eq!(reply[5], 2);
        assert_eq!(&reply[64..68], &[4, 3, 2, 1]);
        assert_eq!(&reply[84..92], &[2, 0, 0xc3, 0x50, 1, 2, 3, 4]);
    }
}
