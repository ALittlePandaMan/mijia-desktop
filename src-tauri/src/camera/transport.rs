//! Restricted CS2 LAN transport, derived from MIT go2rtc/Xiaomi Camera Viewer.
use super::{err, Result};
use std::{
    collections::{BTreeMap, VecDeque},
    io::{Read, Write},
    net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpStream, UdpSocket},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};
enum Socket {
    Udp(UdpSocket, SocketAddr),
    Tcp(TcpStream, Vec<u8>),
}
#[derive(Default)]
struct Channel {
    sequence: u16,
    early: BTreeMap<u16, Vec<u8>>,
    early_bytes: usize,
    bytes: Vec<u8>,
}
impl Channel {
    fn push(
        &mut self,
        sequence: Option<u16>,
        data: &[u8],
        output: &mut VecDeque<(u8, Vec<u8>)>,
        channel: u8,
    ) -> Result<()> {
        if let Some(sequence) = sequence {
            let delta = sequence.wrapping_sub(self.sequence) as i16;
            if delta < 0 {
                return Ok(());
            }
            if delta > 0 {
                if self.early.len() >= 250 {
                    return Err(err("videoPacketLoss", "视频分包缺失，已停止会话。"));
                }
                if !self.early.contains_key(&sequence) {
                    if self.early_bytes + data.len() > 2 * 1024 * 1024 {
                        return Err(err("videoPacketLoss", "视频乱序缓冲超过限制。"));
                    }
                    self.early_bytes += data.len();
                    self.early.insert(sequence, data.to_vec());
                }
                return Ok(());
            }
            self.sequence = self.sequence.wrapping_add(1);
        }
        self.bytes.extend_from_slice(data);
        if sequence.is_some() {
            while let Some(next) = self.early.remove(&self.sequence) {
                self.early_bytes = self.early_bytes.saturating_sub(next.len());
                self.bytes.extend(next);
                self.sequence = self.sequence.wrapping_add(1);
            }
        }
        let limit = if channel == 1 {
            20 * 1024 * 1024
        } else {
            2 * 1024 * 1024
        };
        if self.bytes.len()
            > if channel == 1 {
                limit + 65536
            } else {
                8 * 1024 * 1024
            }
        {
            return Err(err("videoProtocol", "视频消息超过安全长度。"));
        }
        self.drain(output, channel)
    }
    // Reassembly may release hundreds of complete messages after one missing
    // fragment arrives. Leave them in the bounded channel and consume on demand.
    // A burst is not a broken connection, and encoded fragments must not be dropped.
    fn drain(&mut self, output: &mut VecDeque<(u8, Vec<u8>)>, channel: u8) -> Result<()> {
        let limit = if channel == 1 {
            20 * 1024 * 1024
        } else {
            2 * 1024 * 1024
        };
        while self.bytes.len() >= 4 && output.is_empty() {
            let len = u32::from_be_bytes(self.bytes[..4].try_into().unwrap()) as usize;
            if len > limit {
                return Err(err("videoProtocol", "视频消息长度无效。"));
            }
            if self.bytes.len() < len + 4 {
                break;
            }
            output.push_back((channel, self.bytes[4..len + 4].to_vec()));
            self.bytes.drain(..len + 4);
        }
        Ok(())
    }
}
pub struct Connection {
    socket: Socket,
    channels: [Channel; 3],
    output: VecDeque<(u8, Vec<u8>)>,
    sequence: [u16; 4],
    ping: Instant,
    retry: Option<(Vec<u8>, Instant, u8)>,
    retry_fatal: bool,
    received_bytes: u64,
}
fn retryable(error: &std::io::Error) -> bool {
    matches!(
        error.kind(),
        std::io::ErrorKind::TimedOut
            | std::io::ErrorKind::WouldBlock
            | std::io::ErrorKind::Interrupted
    )
}
impl Connection {
    pub fn finish_stop(&mut self) {
        self.flush_command();
        for _ in 0..3 {
            let _ = self.send(&[0xf1, 0xf0, 0, 0]);
        }
    }
    pub fn flush_command(&mut self) {
        // Give the reliable channel time to acknowledge VideoStop before
        // closing its relay socket. Abrupt socket disposal can retain a stale
        // camera session and makes an immediate reopen fail.
        let deadline = Instant::now() + Duration::from_millis(1400);
        while self.retry.is_some() && Instant::now() < deadline {
            if self.next().is_err() {
                break;
            }
        }
    }
    pub fn from_relay((socket, peer): (UdpSocket, SocketAddr)) -> Result<Self> {
        socket
            .set_read_timeout(Some(Duration::from_millis(200)))
            .map_err(|_| super::AppError::protocol())?;
        Ok(Self {
            socket: Socket::Udp(socket, peer),
            channels: Default::default(),
            output: VecDeque::new(),
            sequence: [0; 4],
            ping: Instant::now(),
            retry: None,
            retry_fatal: true,
            received_bytes: 0,
        })
    }
    pub fn connect(host: Ipv4Addr, stop: &AtomicBool) -> Result<Self> {
        let udp = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))
            .map_err(|_| err("videoNetwork", "无法创建视频连接。"))?;
        udp.set_read_timeout(Some(Duration::from_millis(200)))
            .map_err(|_| super::AppError::protocol())?;
        udp.set_broadcast(true)
            .map_err(|_| super::AppError::protocol())?;
        let mut peer: SocketAddr = SocketAddrV4::new(host, 32108).into();
        let mut request = vec![0xf1, 0x30, 0, 0];
        let deadline = Instant::now() + Duration::from_secs(15);
        let mut sent = Instant::now() - Duration::from_secs(2);
        let mut punched = false;
        let mut buffer = [0u8; 65535];
        let tcp = loop {
            if stop.load(Ordering::Acquire) {
                return Err(super::AppError::stale());
            }
            if Instant::now() > deadline {
                return Err(err(
                    "videoConnectTimeout",
                    "摄像机局域网连接超时。请确认电脑与摄像机处于同一网络。",
                ));
            }
            if sent.elapsed() >= Duration::from_secs(1) {
                udp.send_to(&request, peer)
                    .map_err(|_| err("videoNetwork", "视频握手发送失败。"))?;
                if !punched {
                    let _ = udp.send_to(&request, (Ipv4Addr::BROADCAST, 32108));
                }
                sent = Instant::now();
            }
            match udp.recv_from(&mut buffer) {
                Ok((len, address))
                    if address.ip() == std::net::IpAddr::V4(host)
                        && len >= 16
                        && buffer[0] == 0xf1 =>
                {
                    if !punched && buffer[1] == 0x41 {
                        peer = address;
                        request = buffer[..len].to_vec();
                        punched = true;
                        sent = Instant::now() - Duration::from_secs(2);
                    } else if punched && matches!(buffer[1], 0x42 | 0x43) {
                        peer = address;
                        break buffer[1] == 0x43;
                    }
                }
                Ok(_) => {}
                Err(error) if retryable(&error) => {}
                Err(_) => return Err(err("videoNetwork", "视频握手读取失败。")),
            }
        };
        let socket = if tcp {
            let stream = TcpStream::connect_timeout(&peer, Duration::from_secs(3))
                .map_err(|_| err("videoNetwork", "无法连接摄像机视频端口。"))?;
            stream
                .set_read_timeout(Some(Duration::from_millis(200)))
                .map_err(|_| super::AppError::protocol())?;
            stream
                .set_write_timeout(Some(Duration::from_secs(2)))
                .map_err(|_| super::AppError::protocol())?;
            Socket::Tcp(stream, Vec::new())
        } else {
            Socket::Udp(udp, peer)
        };
        Ok(Self {
            socket,
            channels: Default::default(),
            output: VecDeque::new(),
            sequence: [0; 4],
            ping: Instant::now(),
            retry: None,
            retry_fatal: true,
            received_bytes: 0,
        })
    }
    fn send(&mut self, data: &[u8]) -> Result<()> {
        match &mut self.socket {
            Socket::Udp(socket, peer) => {
                socket
                    .send_to(data, *peer)
                    .map_err(|_| err("videoNetwork", "视频连接已中断。"))?;
            }
            Socket::Tcp(socket, _) => {
                let len = u16::try_from(data.len()).map_err(|_| super::AppError::protocol())?;
                let mut header = [0u8; 8];
                header[..2].copy_from_slice(&len.to_be_bytes());
                header[2] = 0x68;
                socket
                    .write_all(&header)
                    .and_then(|_| socket.write_all(data))
                    .map_err(|_| err("videoNetwork", "视频连接已中断。"))?;
            }
        }
        Ok(())
    }
    pub fn command(&mut self, data: &[u8]) -> Result<()> {
        self.write_channel(0, data, true)
    }
    pub fn control_command(&mut self, data: &[u8]) -> Result<()> {
        self.command(data)?;
        self.retry_fatal = false;
        Ok(())
    }
    pub fn write_channel(&mut self, channel: u8, data: &[u8], reliable: bool) -> Result<()> {
        if data.len() > 32000 || channel > 3 {
            return Err(super::AppError::protocol());
        }
        let mut packet = vec![0xf1, 0xd0];
        packet.extend_from_slice(&((data.len() + 8) as u16).to_be_bytes());
        packet.extend_from_slice(&[0xd1, channel]);
        packet.extend_from_slice(&self.sequence[channel as usize].to_be_bytes());
        self.sequence[channel as usize] = self.sequence[channel as usize].wrapping_add(1);
        packet.extend_from_slice(&(data.len() as u32).to_be_bytes());
        packet.extend_from_slice(data);
        self.send(&packet)?;
        if reliable && matches!(self.socket, Socket::Udp(..)) {
            self.retry = Some((packet, Instant::now(), 0));
            self.retry_fatal = true;
        }
        Ok(())
    }
    pub fn received_bytes(&self) -> u64 {
        self.received_bytes
    }
    pub fn set_talk_active(&self, active: bool) -> Result<()> {
        // A serialized 20ms microphone sender must not wait behind the normal
        // 200ms receive timeout when video packets temporarily stop arriving.
        let timeout = Some(Duration::from_millis(if active { 10 } else { 200 }));
        match &self.socket {
            Socket::Udp(socket, _) => socket.set_read_timeout(timeout),
            Socket::Tcp(socket, _) => socket.set_read_timeout(timeout),
        }
        .map_err(|_| super::AppError::protocol())
    }
    fn receive(&mut self) -> Result<Option<Vec<u8>>> {
        match &mut self.socket {
            Socket::Udp(socket, peer) => {
                let mut data = vec![0u8; 65535];
                match socket.recv_from(&mut data) {
                    Ok((len, address)) if address == *peer => {
                        self.received_bytes = self.received_bytes.saturating_add(len as u64);
                        data.truncate(len);
                        Ok(Some(data))
                    }
                    Ok(_) => Ok(None),
                    Err(error) if retryable(&error) => Ok(None),
                    Err(_) => Err(err("videoNetwork", "视频连接已中断。")),
                }
            }
            Socket::Tcp(socket, buffer) => {
                if buffer.len() < 8
                    || buffer.len()
                        < 8 + u16::from_be_bytes(buffer[..2].try_into().unwrap()) as usize
                {
                    let mut data = [0u8; 65535];
                    match socket.read(&mut data) {
                        Ok(0) => return Err(err("videoNetwork", "摄像机已关闭视频连接。")),
                        Ok(len) => {
                            self.received_bytes = self.received_bytes.saturating_add(len as u64);
                            buffer.extend_from_slice(&data[..len]);
                        }
                        Err(error) if retryable(&error) => return Ok(None),
                        Err(_) => return Err(err("videoNetwork", "视频连接已中断。")),
                    }
                }
                if buffer.len() < 8 {
                    return Ok(None);
                }
                let len = u16::from_be_bytes(buffer[..2].try_into().unwrap()) as usize;
                if len < 4 {
                    return Err(super::AppError::protocol());
                }
                if buffer.len() < 8 + len {
                    return Ok(None);
                }
                let packet = buffer[8..8 + len].to_vec();
                buffer.drain(..8 + len);
                Ok(Some(packet))
            }
        }
    }
    pub fn next(&mut self) -> Result<Option<(u8, Vec<u8>)>> {
        for (channel, buffer) in self.channels.iter_mut().enumerate() {
            buffer.drain(&mut self.output, channel as u8)?;
        }
        if let Some(message) = self.output.pop_front() {
            return Ok(Some(message));
        }
        if matches!(self.socket, Socket::Tcp(..)) && self.ping.elapsed() >= Duration::from_secs(1) {
            self.send(&[0xf1, 0xe0, 0, 0])?;
            self.ping = Instant::now();
        }
        if let Some((data, time, count)) = &self.retry {
            if time.elapsed() >= Duration::from_secs(1) {
                if *count >= 5 {
                    if self.retry_fatal {
                        return Err(err("videoCommandTimeout", "摄像机未确认视频请求。"));
                    }
                    self.retry = None;
                    return Ok(None);
                }
                let data = data.clone();
                let count = count + 1;
                self.send(&data)?;
                self.retry = Some((data, Instant::now(), count));
            }
        }
        let Some(packet) = self.receive()? else {
            return Ok(None);
        };
        if packet.len() < 4 || packet[0] != 0xf1 {
            return Err(super::AppError::protocol());
        }
        match packet[1] {
            0x28 => {
                if let Socket::Udp(socket, _) = &self.socket {
                    if let Ok(local) = socket.local_addr() {
                        if let Some(reply) = super::relay_list::link_reply(&packet[4..], local) {
                            self.send(&reply)?;
                        }
                    }
                }
            }
            0xe0 => self.send(&[0xf1, 0xe1, 0, 0])?,
            0xd1 => {
                if packet.len() >= 10
                    && self.retry.as_ref().is_some_and(|(data, _, _)| {
                        packet[5] == data[5] && packet[8..10] == data[6..8]
                    })
                {
                    self.retry = None;
                }
            }
            0xd0 => {
                if packet.len() < 8 || packet[4] != 0xd1 {
                    return Err(super::AppError::protocol());
                }
                let channel = packet[5];
                let seq = u16::from_be_bytes(packet[6..8].try_into().unwrap());
                let udp = matches!(self.socket, Socket::Udp(..));
                if udp {
                    self.send(&[0xf1, 0xd1, 0, 6, 0xd1, channel, 0, 1, packet[6], packet[7]])?;
                }
                if matches!(channel, 0..=2) {
                    self.channels[channel as usize].push(
                        if udp { Some(seq) } else { None },
                        &packet[8..],
                        &mut self.output,
                        channel,
                    )?;
                }
            }
            _ => {}
        }
        Ok(self.output.pop_front())
    }
}
impl Drop for Connection {
    fn drop(&mut self) {
        let _ = self.send(&[0xf1, 0xf0, 0, 0]);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn burst_of_complete_messages_is_consumed_without_queue_overflow() {
        let mut channel = Channel::default();
        let mut output = VecDeque::new();
        let wire: Vec<u8> = (0..180u8).flat_map(|n| [0, 0, 0, 1, n]).collect();
        channel.push(Some(1), &wire[3..], &mut output, 2).unwrap();
        channel.push(Some(0), &wire[..3], &mut output, 2).unwrap();
        for expected in 0..180u8 {
            channel.drain(&mut output, 2).unwrap();
            assert_eq!(output.pop_front(), Some((2, vec![expected])));
        }
        assert!(channel.bytes.is_empty());
        assert!(channel.early.is_empty());
    }
    #[test]
    fn a_missing_control_transport_ack_does_not_kill_live_video() {
        let peer = UdpSocket::bind("127.0.0.1:0").unwrap();
        let client = UdpSocket::bind("127.0.0.1:0").unwrap();
        let mut c = Connection::from_relay((client, peer.local_addr().unwrap())).unwrap();
        c.control_command(&[0, 0, 1, 9]).unwrap();
        c.retry.as_mut().unwrap().1 = Instant::now() - Duration::from_secs(2);
        c.retry.as_mut().unwrap().2 = 5;
        assert!(c.next().unwrap().is_none());
        assert!(c.retry.is_none());
        c.command(&[0, 0, 1, 2]).unwrap();
        c.retry.as_mut().unwrap().1 = Instant::now() - Duration::from_secs(2);
        c.retry.as_mut().unwrap().2 = 5;
        assert!(c.next().is_err());
    }
    #[test]
    fn stop_is_acknowledged_before_repeated_close() {
        let peer = UdpSocket::bind("127.0.0.1:0").unwrap();
        peer.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
        let client = UdpSocket::bind("127.0.0.1:0").unwrap();
        let address = peer.local_addr().unwrap();
        let mock = std::thread::spawn(move || {
            let mut packet = [0u8; 2048];
            let (len, from) = peer.recv_from(&mut packet).unwrap();
            assert!(len >= 12);
            assert_eq!(packet[1], 0xd0);
            let ack = [
                0xf1, 0xd1, 0, 6, 0xd1, packet[5], 0, 1, packet[6], packet[7],
            ];
            peer.send_to(&ack, from).unwrap();
            for _ in 0..3 {
                let (len, _) = peer.recv_from(&mut packet).unwrap();
                assert_eq!(&packet[..len], &[0xf1, 0xf0, 0, 0]);
            }
        });
        let mut connection = Connection::from_relay((client, address)).unwrap();
        connection.command(&0x103u32.to_be_bytes()).unwrap();
        connection.finish_stop();
        assert!(connection.retry.is_none());
        mock.join().unwrap();
    }
    #[test]
    fn reordered_fragmented_length_prefix_and_duplicates() {
        let mut channel = Channel::default();
        let mut out = VecDeque::new();
        channel.push(Some(1), &[3, 1, 2, 3], &mut out, 2).unwrap();
        assert!(out.is_empty());
        channel.push(Some(0), &[0, 0, 0], &mut out, 2).unwrap();
        assert_eq!(out.pop_front(), Some((2, vec![1, 2, 3])));
        channel.push(Some(1), &[3, 1, 2, 3], &mut out, 2).unwrap();
        assert!(out.is_empty());
    }
    #[test]
    fn rejects_unbounded_message() {
        assert!(Channel::default()
            .push(None, &[0xff, 0xff, 0xff, 0xff], &mut VecDeque::new(), 2)
            .is_err());
    }
}
