//! Join the independently initialized fMP4 files returned by the cloud HLS
//! processor. No samples are decoded or discarded, including audio samples.
//! Accepted files use self-contained AVC/HEVC/AAC sample entries and ordinary
//! `tfhd`/`tfdt`/`trun` fragments; external data and encrypted sample tables are
//! deliberately outside this adapter's contract.
use crate::error::{AppError, Result};
use std::collections::BTreeMap;

const LIMIT: usize = 48 * 1024 * 1024;
const MAX_SAMPLES: u32 = 1_000_000;

#[derive(Clone, Copy)]
struct Atom<'a> {
    kind: [u8; 4],
    raw: &'a [u8],
    payload: &'a [u8],
    start: usize,
    header: usize,
}
fn bad<T>() -> Result<T> {
    Err(AppError::protocol())
}
fn u32_at(bytes: &[u8], at: usize) -> Result<u32> {
    Ok(u32::from_be_bytes(
        bytes
            .get(at..at.checked_add(4).ok_or_else(AppError::protocol)?)
            .ok_or_else(AppError::protocol)?
            .try_into()
            .map_err(|_| AppError::protocol())?,
    ))
}
fn u64_at(bytes: &[u8], at: usize) -> Result<u64> {
    Ok(u64::from_be_bytes(
        bytes
            .get(at..at.checked_add(8).ok_or_else(AppError::protocol)?)
            .ok_or_else(AppError::protocol)?
            .try_into()
            .map_err(|_| AppError::protocol())?,
    ))
}
fn atoms(bytes: &[u8], origin: usize) -> Result<Vec<Atom<'_>>> {
    let mut result = Vec::new();
    let mut at = 0;
    while at < bytes.len() {
        if result.len() >= 4096 {
            return bad();
        }
        let mut size = u32_at(bytes, at)? as usize;
        let kind: [u8; 4] = bytes
            .get(at + 4..at + 8)
            .ok_or_else(AppError::protocol)?
            .try_into()
            .map_err(|_| AppError::protocol())?;
        let header = if size == 1 {
            size = usize::try_from(u64_at(bytes, at + 8)?).map_err(|_| AppError::protocol())?;
            16
        } else {
            8
        };
        // A zero-sized atom consumes the enclosing file. Reject it rather than
        // allowing an index or a later fragment to be hidden in its payload.
        if size < header {
            return bad();
        }
        let end = at
            .checked_add(size)
            .filter(|end| *end <= bytes.len())
            .ok_or_else(AppError::protocol)?;
        let raw = &bytes[at..end];
        result.push(Atom {
            kind,
            raw,
            payload: &raw[header..],
            start: origin.checked_add(at).ok_or_else(AppError::protocol)?,
            header,
        });
        at = end;
    }
    Ok(result)
}
fn children(atom: Atom<'_>) -> Result<Vec<Atom<'_>>> {
    atoms(atom.payload, atom.start + atom.header)
}
fn unique<'a, 'b>(list: &'b [Atom<'a>], kind: &[u8; 4]) -> Result<&'b Atom<'a>> {
    let mut found = list.iter().filter(|atom| &atom.kind == kind);
    let result = found.next().ok_or_else(AppError::protocol)?;
    if found.next().is_some() {
        return bad();
    }
    Ok(result)
}
fn full(atom: Atom<'_>) -> Result<(u8, u32)> {
    let value = u32_at(atom.payload, 0)?;
    Ok(((value >> 24) as u8, value & 0x00ff_ffff))
}
fn push_atom(out: &mut Vec<u8>, kind: &[u8; 4], payload: &[u8]) -> Result<()> {
    let size = payload
        .len()
        .checked_add(8)
        .filter(|n| *n <= LIMIT)
        .ok_or_else(AppError::protocol)?;
    if out.len().checked_add(size).is_none_or(|n| n > LIMIT) {
        return bad();
    }
    out.extend_from_slice(&(size as u32).to_be_bytes());
    out.extend_from_slice(kind);
    out.extend_from_slice(payload);
    Ok(())
}
fn full_word(version: u8, flags: u32) -> [u8; 4] {
    (((version as u32) << 24) | flags).to_be_bytes()
}

#[derive(Clone, Copy, Default)]
struct Track {
    descriptions: u32,
    description: u32,
    duration: u32,
    size: u32,
}
fn track_info(trak: Atom<'_>) -> Result<(u32, Track)> {
    let contents = children(trak)?;
    let tkhd = *unique(&contents, b"tkhd")?;
    let (version, _) = full(tkhd)?;
    if !matches!((version, tkhd.payload.len()), (0, 84) | (1, 96)) {
        return bad();
    }
    let id = u32_at(
        tkhd.payload,
        match version {
            0 => 12,
            1 => 20,
            _ => return bad(),
        },
    )?;
    if id == 0 {
        return bad();
    }
    let mdia = children(*unique(&contents, b"mdia")?)?;
    let mdhd = *unique(&mdia, b"mdhd")?;
    let (version, flags) = full(mdhd)?;
    if flags != 0 || !matches!((version, mdhd.payload.len()), (0, 24) | (1, 36)) {
        return bad();
    }
    let timescale = u32_at(
        mdhd.payload,
        match version {
            0 => 12,
            1 => 20,
            _ => return bad(),
        },
    )?;
    if timescale == 0 {
        return bad();
    }
    let minf = children(*unique(&mdia, b"minf")?)?;
    let dinf = children(*unique(&minf, b"dinf")?)?;
    let dref = *unique(&dinf, b"dref")?;
    if full(dref)? != (0, 0) {
        return bad();
    }
    let ref_count = u32_at(dref.payload, 4)?;
    let refs = atoms(
        dref.payload.get(8..).ok_or_else(AppError::protocol)?,
        dref.start + dref.header + 8,
    )?;
    if refs.is_empty() || refs.len() != ref_count as usize || refs.len() > 16 {
        return bad();
    }
    for entry in &refs {
        // URL flag 1 means this file itself, and has no URL string. Reject
        // named URLs and URNs even when a sample entry does not reference them.
        if &entry.kind != b"url " || full(*entry)? != (0, 1) || entry.payload.len() != 4 {
            return bad();
        }
    }
    let stbl = children(*unique(&minf, b"stbl")?)?;
    let stsd = *unique(&stbl, b"stsd")?;
    if full(stsd)? != (0, 0) {
        return bad();
    }
    let count = u32_at(stsd.payload, 4)?;
    let entries = atoms(
        stsd.payload.get(8..).ok_or_else(AppError::protocol)?,
        stsd.start + stsd.header + 8,
    )?;
    if count == 0 || count > 16 || entries.len() != count as usize {
        return bad();
    }
    for entry in entries {
        if !matches!(&entry.kind, b"hvc1" | b"hev1" | b"avc1" | b"avc3" | b"mp4a") {
            return bad();
        }
        let index = entry.payload.get(6..8).ok_or_else(AppError::protocol)?;
        let index = u16::from_be_bytes([index[0], index[1]]) as u32;
        if index == 0 || index > ref_count {
            return bad();
        }
        let (header, config) = if &entry.kind == b"mp4a" {
            (28usize, b"esds")
        } else if matches!(&entry.kind, b"hvc1" | b"hev1") {
            (78, b"hvcC")
        } else {
            (78, b"avcC")
        };
        let codec = atoms(
            entry.payload.get(header..).ok_or_else(AppError::protocol)?,
            entry.start + entry.header + header,
        )?;
        let config = *unique(&codec, config)?;
        let minimum = match &config.kind {
            b"hvcC" => 23,
            b"avcC" => 7,
            _ => 8,
        };
        if config.payload.len() < minimum {
            return bad();
        }
    }
    Ok((
        id,
        Track {
            descriptions: count,
            ..Track::default()
        },
    ))
}
fn tracks(moov: Atom<'_>) -> Result<BTreeMap<u32, Track>> {
    let contents = children(moov)?;
    let mut result = BTreeMap::new();
    for trak in contents.iter().filter(|atom| &atom.kind == b"trak") {
        let (id, track) = track_info(*trak)?;
        if result.insert(id, track).is_some() || result.len() > 8 {
            return bad();
        }
    }
    if result.is_empty() {
        return bad();
    }
    let mvex = children(*unique(&contents, b"mvex")?)?;
    let mut seen = BTreeMap::new();
    for trex in mvex.iter().filter(|atom| &atom.kind == b"trex") {
        if full(*trex)? != (0, 0) || trex.payload.len() != 24 {
            return bad();
        }
        let id = u32_at(trex.payload, 4)?;
        let track = result.get_mut(&id).ok_or_else(AppError::protocol)?;
        if seen.insert(id, ()).is_some() {
            return bad();
        }
        track.description = u32_at(trex.payload, 8)?;
        track.duration = u32_at(trex.payload, 12)?;
        track.size = u32_at(trex.payload, 16)?;
        if track.description == 0 || track.description > track.descriptions {
            return bad();
        }
    }
    if seen.len() != result.len() {
        return bad();
    }
    Ok(result)
}

type Descriptions = BTreeMap<u32, Vec<Vec<u8>>>;
type DescriptionMap = BTreeMap<(u32, u32), u32>;
type Dimensions = BTreeMap<u32, [u32; 2]>;
fn track_id(trak: Atom<'_>) -> Result<u32> {
    let fields = children(trak)?;
    let tkhd = *unique(&fields, b"tkhd")?;
    let (version, _) = full(tkhd)?;
    u32_at(
        tkhd.payload,
        match version {
            0 => 12,
            1 => 20,
            _ => return bad(),
        },
    )
}
fn sample_entries(trak: Atom<'_>) -> Result<Vec<Atom<'_>>> {
    let fields = children(trak)?;
    let mdia = children(*unique(&fields, b"mdia")?)?;
    let minf = children(*unique(&mdia, b"minf")?)?;
    let stbl = children(*unique(&minf, b"stbl")?)?;
    let stsd = *unique(&stbl, b"stsd")?;
    atoms(
        stsd.payload.get(8..).ok_or_else(AppError::protocol)?,
        stsd.start + stsd.header + 8,
    )
}
fn movie_atom(
    atom: Atom<'_>,
    track: Option<u32>,
    descriptions: &Descriptions,
    dimensions: &Dimensions,
    canonical: bool,
) -> Result<Vec<u8>> {
    let track = if &atom.kind == b"trak" {
        Some(track_id(atom)?)
    } else {
        track
    };
    let mut payload = Vec::new();
    match &atom.kind {
        b"stsd" => {
            payload.extend_from_slice(&full_word(0, 0));
            if canonical {
                payload.extend_from_slice(&0u32.to_be_bytes());
            } else {
                let entries = descriptions
                    .get(&track.ok_or_else(AppError::protocol)?)
                    .ok_or_else(AppError::protocol)?;
                payload.extend_from_slice(&(entries.len() as u32).to_be_bytes());
                for entry in entries {
                    payload.extend_from_slice(entry);
                }
            }
        }
        b"tkhd" => {
            payload.extend_from_slice(atom.payload);
            let at = payload
                .len()
                .checked_sub(8)
                .ok_or_else(AppError::protocol)?;
            let size = if canonical {
                [0, 0]
            } else {
                *dimensions
                    .get(&track.ok_or_else(AppError::protocol)?)
                    .ok_or_else(AppError::protocol)?
            };
            payload[at..at + 4].copy_from_slice(&size[0].to_be_bytes());
            payload[at + 4..].copy_from_slice(&size[1].to_be_bytes());
        }
        b"moov" | b"trak" | b"mdia" | b"minf" | b"stbl" | b"dinf" | b"mvex" => {
            for child in children(atom)? {
                payload.extend_from_slice(&movie_atom(
                    child,
                    track,
                    descriptions,
                    dimensions,
                    canonical,
                )?);
            }
        }
        _ => return Ok(atom.raw.to_vec()),
    }
    let mut result = Vec::new();
    push_atom(&mut result, &atom.kind, &payload)?;
    Ok(result)
}
fn merge_descriptions(
    moov: Atom<'_>,
    descriptions: &mut Descriptions,
    dimensions: &mut Dimensions,
) -> Result<DescriptionMap> {
    let mut mapping = BTreeMap::new();
    for trak in children(moov)?
        .into_iter()
        .filter(|atom| &atom.kind == b"trak")
    {
        let id = track_id(trak)?;
        let fields = children(trak)?;
        let tkhd = *unique(&fields, b"tkhd")?;
        let at = tkhd
            .payload
            .len()
            .checked_sub(8)
            .ok_or_else(AppError::protocol)?;
        let size = [u32_at(tkhd.payload, at)?, u32_at(tkhd.payload, at + 4)?];
        let target_size = dimensions.entry(id).or_insert(size);
        target_size[0] = target_size[0].max(size[0]);
        target_size[1] = target_size[1].max(size[1]);
        let target = descriptions.entry(id).or_default();
        for (index, entry) in sample_entries(trak)?.into_iter().enumerate() {
            // A resolution/configuration change within one codec is supported;
            // changing a track between unrelated codecs is not.
            if target
                .first()
                .is_some_and(|first| first.get(4..8) != Some(&entry.kind))
            {
                return bad();
            }
            let destination = if let Some(at) = target.iter().position(|bytes| bytes == entry.raw) {
                at
            } else {
                if target.len() >= 16 {
                    return bad();
                }
                target.push(entry.raw.to_vec());
                target.len() - 1
            };
            mapping.insert((id, index as u32 + 1), destination as u32 + 1);
        }
    }
    Ok(mapping)
}

struct Header {
    track: u32,
    description: u32,
    base: Option<u64>,
    default_moof: bool,
    duration: u32,
    size: u32,
    tail: usize,
}
fn fragment_header(atom: Atom<'_>, tracks: &BTreeMap<u32, Track>) -> Result<Header> {
    let (version, flags) = full(atom)?;
    if version != 0 || flags & !0x03003b != 0 || flags & 0x010000 != 0 {
        return bad();
    }
    let id = u32_at(atom.payload, 4)?;
    let track = tracks.get(&id).ok_or_else(AppError::protocol)?;
    let mut at = 8;
    let base = if flags & 1 != 0 {
        let value = u64_at(atom.payload, at)?;
        at += 8;
        Some(value)
    } else {
        None
    };
    let description = if flags & 2 != 0 {
        let value = u32_at(atom.payload, at)?;
        at += 4;
        value
    } else {
        track.description
    };
    if description == 0 || description > track.descriptions {
        return bad();
    }
    let tail = at;
    let duration = if flags & 8 != 0 {
        let value = u32_at(atom.payload, at)?;
        at += 4;
        value
    } else {
        track.duration
    };
    let size = if flags & 0x10 != 0 {
        let value = u32_at(atom.payload, at)?;
        at += 4;
        value
    } else {
        track.size
    };
    if flags & 0x20 != 0 {
        let _ = u32_at(atom.payload, at)?;
        at += 4;
    }
    if at != atom.payload.len() {
        return bad();
    }
    Ok(Header {
        track: id,
        description,
        base,
        default_moof: flags & 0x020000 != 0,
        duration,
        size,
        tail,
    })
}
struct Run {
    bytes: Vec<u8>,
    start: u64,
    end: u64,
    duration: u64,
}
fn run(atom: Atom<'_>, header: &Header, base: u64, previous_end: Option<u64>) -> Result<Run> {
    let (version, flags) = full(atom)?;
    if version > 1 || flags & !0x000f05 != 0 || flags & 0x404 == 0x404 {
        return bad();
    }
    let count = u32_at(atom.payload, 4)?;
    if count == 0 || count > MAX_SAMPLES {
        return bad();
    }
    let mut at = 8;
    let start = if flags & 1 != 0 {
        let offset = u32_at(atom.payload, at)? as i32;
        at += 4;
        let value = i128::from(base) + i128::from(offset);
        u64::try_from(value).map_err(|_| AppError::protocol())?
    } else {
        previous_end.unwrap_or(base)
    };
    let tail = at;
    if flags & 4 != 0 {
        let _ = u32_at(atom.payload, at)?;
        at += 4;
    }
    let width = ((flags >> 8) & 15).count_ones() as usize * 4;
    let table_size = (count as usize)
        .checked_mul(width)
        .ok_or_else(AppError::protocol)?;
    if at.checked_add(table_size) != Some(atom.payload.len()) {
        return bad();
    }
    let mut duration = 0u64;
    let mut size = 0u64;
    // With entirely default durations/sizes a small box can name a huge sample
    // count; compute it in constant time instead of trusting that count to loop.
    if flags & 0x300 == 0 {
        if header.duration == 0 || header.size == 0 {
            return bad();
        }
        duration = u64::from(header.duration) * u64::from(count);
        size = u64::from(header.size) * u64::from(count);
        at += table_size;
    } else {
        for _ in 0..count {
            let d = if flags & 0x100 != 0 {
                let value = u32_at(atom.payload, at)?;
                at += 4;
                value
            } else {
                header.duration
            };
            let s = if flags & 0x200 != 0 {
                let value = u32_at(atom.payload, at)?;
                at += 4;
                value
            } else {
                header.size
            };
            if d == 0 || s == 0 {
                return bad();
            }
            duration = duration
                .checked_add(u64::from(d))
                .ok_or_else(AppError::protocol)?;
            size = size
                .checked_add(u64::from(s))
                .ok_or_else(AppError::protocol)?;
            if flags & 0x400 != 0 {
                let _ = u32_at(atom.payload, at)?;
                at += 4;
            }
            if flags & 0x800 != 0 {
                let _ = u32_at(atom.payload, at)?;
                at += 4;
            }
        }
    }
    if at != atom.payload.len() {
        return bad();
    }
    let mut bytes = Vec::with_capacity(atom.payload.len() + 4);
    bytes.extend_from_slice(&full_word(version, flags | 1));
    bytes.extend_from_slice(&count.to_be_bytes());
    bytes.extend_from_slice(&0u32.to_be_bytes());
    bytes.extend_from_slice(&atom.payload[tail..]);
    Ok(Run {
        bytes,
        start,
        end: start.checked_add(size).ok_or_else(AppError::protocol)?,
        duration,
    })
}
struct RewrittenTraf {
    content: Vec<([u8; 4], Vec<u8>, Option<usize>)>,
}
fn rewrite(
    moof: Atom<'_>,
    mdat: Atom<'_>,
    tracks: &BTreeMap<u32, Track>,
    descriptions: &DescriptionMap,
    times: &mut BTreeMap<u32, u64>,
    position: usize,
    sequence: u32,
) -> Result<Vec<u8>> {
    let contents = children(moof)?;
    if contents
        .iter()
        .any(|atom| !matches!(&atom.kind, b"mfhd" | b"traf"))
    {
        return bad();
    }
    let mfhd = *unique(&contents, b"mfhd")?;
    if full(mfhd)? != (0, 0) || mfhd.payload.len() != 8 {
        return bad();
    }
    let mut rewritten = Vec::new();
    let mut ranges = Vec::new();
    let mut implicit_base = moof.start as u64;
    let mut seen = BTreeMap::new();
    for traf in contents.iter().filter(|atom| &atom.kind == b"traf") {
        let children = children(*traf)?;
        if children
            .iter()
            .any(|atom| !matches!(&atom.kind, b"tfhd" | b"tfdt" | b"trun"))
        {
            return bad();
        }
        let tfhd = *unique(&children, b"tfhd")?;
        let tfdt = *unique(&children, b"tfdt")?;
        let header = fragment_header(tfhd, tracks)?;
        if seen.insert(header.track, ()).is_some() {
            return bad();
        }
        let (version, flags) = full(tfdt)?;
        if flags != 0 || !matches!((version, tfdt.payload.len()), (0, 8) | (1, 12)) {
            return bad();
        }
        let base = header.base.unwrap_or(if header.default_moof {
            moof.start as u64
        } else {
            implicit_base
        });
        let mut previous_end = None;
        let mut duration = 0u64;
        let mut runs = Vec::new();
        for atom in children.iter().filter(|atom| &atom.kind == b"trun") {
            let parsed = run(*atom, &header, base, previous_end)?;
            let payload_start = (mdat.start + mdat.header) as u64;
            let payload_end = (mdat.start + mdat.raw.len()) as u64;
            if parsed.start < payload_start || parsed.end > payload_end {
                return bad();
            }
            previous_end = Some(parsed.end);
            duration = duration
                .checked_add(parsed.duration)
                .ok_or_else(AppError::protocol)?;
            ranges.push((parsed.start, parsed.end));
            runs.push(parsed);
        }
        if runs.is_empty() {
            return bad();
        }
        implicit_base = previous_end.ok_or_else(AppError::protocol)?;
        let time = times.entry(header.track).or_insert(0);
        let mut time_bytes = Vec::from(full_word(1, 0));
        time_bytes.extend_from_slice(&time.to_be_bytes());
        *time = time.checked_add(duration).ok_or_else(AppError::protocol)?;
        let (_, flags) = full(tfhd)?;
        let mut header_bytes = Vec::from(full_word(0, (flags | 3) & !0x020000));
        header_bytes.extend_from_slice(&header.track.to_be_bytes());
        header_bytes.extend_from_slice(&(position as u64).to_be_bytes());
        header_bytes.extend_from_slice(
            &descriptions
                .get(&(header.track, header.description))
                .ok_or_else(AppError::protocol)?
                .to_be_bytes(),
        );
        header_bytes.extend_from_slice(&tfhd.payload[header.tail..]);
        let mut content = vec![(*b"tfhd", header_bytes, None), (*b"tfdt", time_bytes, None)];
        for run in runs {
            let relative = usize::try_from(run.start - (mdat.start + mdat.header) as u64)
                .map_err(|_| AppError::protocol())?;
            content.push((*b"trun", run.bytes, Some(relative)));
        }
        rewritten.push(RewrittenTraf { content });
    }
    if rewritten.is_empty() {
        return bad();
    }
    ranges.sort_unstable();
    if ranges.windows(2).any(|pair| pair[0].1 > pair[1].0) {
        return bad();
    }
    let mut length = 8usize + 16;
    for traf in &rewritten {
        length = length.checked_add(8).ok_or_else(AppError::protocol)?;
        for (_, bytes, _) in &traf.content {
            length = length
                .checked_add(bytes.len() + 8)
                .ok_or_else(AppError::protocol)?;
        }
    }
    if length > LIMIT {
        return bad();
    }
    let mut body = Vec::new();
    let mut mfhd_bytes = Vec::from(full_word(0, 0));
    mfhd_bytes.extend_from_slice(&sequence.to_be_bytes());
    push_atom(&mut body, b"mfhd", &mfhd_bytes)?;
    for traf in &mut rewritten {
        let mut bytes = Vec::new();
        for (kind, payload, relative) in &mut traf.content {
            if let Some(relative) = relative {
                let offset = length
                    .checked_add(mdat.header)
                    .and_then(|n| n.checked_add(*relative))
                    .ok_or_else(AppError::protocol)?;
                let offset = i32::try_from(offset).map_err(|_| AppError::protocol())?;
                payload[8..12].copy_from_slice(&offset.to_be_bytes());
            }
            push_atom(&mut bytes, kind, payload)?;
        }
        push_atom(&mut body, b"traf", &bytes)?;
    }
    let mut result = Vec::new();
    push_atom(&mut result, b"moof", &body)?;
    if result.len() != length {
        return bad();
    }
    Ok(result)
}

/// Each input is a complete, decrypted cloud HLS fMP4 segment. Relocate data
/// offsets and make decode times continuous independently in each track's
/// native timescale. Obsolete `sidx`/`mfra` indexes are omitted.
pub fn join(segments: Vec<Vec<u8>>) -> Result<Vec<u8>> {
    if segments.is_empty() || segments.len() > 100 {
        return bad();
    }
    let total = segments
        .iter()
        .try_fold(0usize, |n, segment| {
            n.checked_add(segment.len()).filter(|n| *n <= LIMIT)
        })
        .ok_or_else(AppError::protocol)?;
    if total == 0 {
        return bad();
    }
    let parsed = segments
        .iter()
        .map(|segment| atoms(segment, 0))
        .collect::<Result<Vec<_>>>()?;
    let mut init: Option<(Vec<u8>, Vec<u8>)> = None;
    let mut definitions = Vec::new();
    let mut mappings = Vec::new();
    let mut descriptions = BTreeMap::new();
    let mut dimensions = BTreeMap::new();
    for top in &parsed {
        let ftyp = *unique(top, b"ftyp")?;
        let moov = *unique(top, b"moov")?;
        if ftyp.start != 0
            || ftyp.payload.len() < 8
            || ftyp.payload.len() % 4 != 0
            || moov.start < ftyp.raw.len()
        {
            return bad();
        }
        definitions.push(tracks(moov)?);
        let canonical = movie_atom(moov, None, &Descriptions::new(), &Dimensions::new(), true)?;
        if let Some((file_type, movie)) = &init {
            if ftyp.raw != file_type || &canonical != movie {
                return bad();
            }
        } else {
            init = Some((ftyp.raw.to_vec(), canonical));
        }
        mappings.push(merge_descriptions(
            moov,
            &mut descriptions,
            &mut dimensions,
        )?);
    }
    let first = parsed.first().ok_or_else(AppError::protocol)?;
    let mut result = unique(first, b"ftyp")?.raw.to_vec();
    result.extend_from_slice(&movie_atom(
        *unique(first, b"moov")?,
        None,
        &descriptions,
        &dimensions,
        false,
    )?);
    let mut times = BTreeMap::new();
    let mut sequence = 1u32;
    for (segment_index, top) in parsed.iter().enumerate() {
        let moov = *unique(top, b"moov")?;
        let mut pairs = 0;
        let mut at = 0;
        while at < top.len() {
            let atom = top[at];
            match &atom.kind {
                b"ftyp" | b"moov" | b"free" | b"skip" | b"styp" | b"sidx" | b"mfra" => at += 1,
                b"moof" => {
                    if atom.start <= moov.start {
                        return bad();
                    }
                    let mdat = *top
                        .get(at + 1)
                        .filter(|atom| &atom.kind == b"mdat")
                        .ok_or_else(AppError::protocol)?;
                    let fragment = rewrite(
                        atom,
                        mdat,
                        &definitions[segment_index],
                        &mappings[segment_index],
                        &mut times,
                        result.len(),
                        sequence,
                    )?;
                    if result
                        .len()
                        .checked_add(fragment.len())
                        .and_then(|n| n.checked_add(mdat.raw.len()))
                        .is_none_or(|n| n > LIMIT)
                    {
                        return bad();
                    }
                    result.extend_from_slice(&fragment);
                    result.extend_from_slice(mdat.raw);
                    sequence = sequence.checked_add(1).ok_or_else(AppError::protocol)?;
                    pairs += 1;
                    at += 2;
                }
                _ => return bad(),
            }
        }
        if pairs == 0 {
            return bad();
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn atom(kind: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut value = Vec::new();
        push_atom(&mut value, kind, payload).unwrap();
        value
    }
    fn cat(parts: &[Vec<u8>]) -> Vec<u8> {
        parts.concat()
    }
    fn words(values: &[u32]) -> Vec<u8> {
        values
            .iter()
            .flat_map(|value| value.to_be_bytes())
            .collect()
    }
    fn init() -> Vec<u8> {
        let mut traks = Vec::new();
        for (id, codec, scale) in [(1u32, *b"hvc1", 90_000u32), (2, *b"mp4a", 48_000)] {
            let mut header = vec![0; 84];
            header[12..16].copy_from_slice(&id.to_be_bytes());
            let tkhd = atom(b"tkhd", &header);
            let mut media = vec![0; 24];
            media[12..16].copy_from_slice(&scale.to_be_bytes());
            let mdhd = atom(b"mdhd", &media);
            let dref = atom(
                b"dref",
                &cat(&[words(&[0, 1]), atom(b"url ", &words(&[1]))]),
            );
            let dinf = atom(b"dinf", &dref);
            let mut sample = vec![0; if id == 1 { 78 } else { 28 }];
            sample[7] = 1;
            let mut config = vec![0; if id == 1 { 23 } else { 8 }];
            if id == 1 {
                config[0] = 1;
            }
            sample.extend_from_slice(&atom(if id == 1 { b"hvcC" } else { b"esds" }, &config));
            let sample = atom(&codec, &sample);
            let stsd = atom(b"stsd", &cat(&[words(&[0, 1]), sample]));
            let stbl = atom(b"stbl", &stsd);
            let minf = atom(b"minf", &cat(&[dinf, stbl]));
            let mdia = atom(b"mdia", &cat(&[mdhd, minf]));
            traks.push(atom(b"trak", &cat(&[tkhd, mdia])));
        }
        let mvex = atom(
            b"mvex",
            &cat(&[
                atom(b"trex", &words(&[0, 1, 1, 0, 0, 0])),
                atom(b"trex", &words(&[0, 2, 1, 7, 2, 0])),
            ]),
        );
        traks.push(mvex);
        cat(&[
            atom(b"ftyp", b"isom\0\0\0\0iso6"),
            atom(b"moov", &cat(&traks)),
        ])
    }
    fn segment(implicit: bool, extended_mdat: bool) -> Vec<u8> {
        let initial = init();
        let mut trafs = Vec::new();
        for id in [1u32, 2] {
            let mut header = words(&[
                if implicit {
                    if id == 1 {
                        0x020000
                    } else {
                        0
                    }
                } else {
                    1
                },
                id,
            ]);
            if !implicit {
                header.extend_from_slice(&(initial.len() as u64).to_be_bytes());
            }
            let tfhd = atom(b"tfhd", &header);
            // v0 also exercises expansion to a 64-bit v1 decode-time box.
            let tfdt = atom(b"tfdt", &words(&[0, 0]));
            let trun = if id == 1 {
                atom(b"trun", &words(&[0x301, 2, 0, 10, 2, 20, 3]))
            } else if implicit {
                atom(b"trun", &words(&[0, 3]))
            } else {
                atom(b"trun", &words(&[1, 3, 0]))
            };
            trafs.push(atom(b"traf", &cat(&[tfhd, tfdt, trun])));
        }
        let mut body = atom(b"mfhd", &words(&[0, 1]));
        body.extend_from_slice(&cat(&trafs));
        let mut moof = atom(b"moof", &body);
        let mdat_header = if extended_mdat { 16 } else { 8 };
        let mut data_offset = moof.len() + mdat_header;
        // Install source offsets only after the original moof size is known.
        let offsets: Vec<_> = children(atoms(&moof, 0).unwrap()[0])
            .unwrap()
            .iter()
            .filter(|entry| &entry.kind == b"traf")
            .flat_map(|traf| children(*traf).unwrap())
            .filter(|entry| &entry.kind == b"trun")
            .map(|entry| {
                (
                    entry.start + entry.header + 8,
                    u32_at(entry.payload, 0).unwrap() & 1 != 0,
                )
            })
            .collect();
        for (index, (offset, explicit)) in offsets.into_iter().enumerate() {
            if explicit {
                moof[offset..offset + 4].copy_from_slice(&(data_offset as u32).to_be_bytes());
            }
            data_offset += if index == 0 { 5 } else { 6 };
        }
        let samples = (1..=11u8).collect::<Vec<_>>();
        let mdat = if extended_mdat {
            cat(&[
                words(&[1]),
                b"mdat".to_vec(),
                ((samples.len() + 16) as u64).to_be_bytes().to_vec(),
                samples,
            ])
        } else {
            atom(b"mdat", &samples)
        };
        cat(&[initial, moof, mdat, atom(b"mfra", &[])])
    }
    fn assert_continuous(bytes: &[u8], fragments: usize) {
        let top = atoms(bytes, 0).unwrap();
        assert_eq!(top.iter().filter(|atom| &atom.kind == b"ftyp").count(), 1);
        assert_eq!(top.iter().filter(|atom| &atom.kind == b"moov").count(), 1);
        assert_eq!(
            top.iter().filter(|atom| &atom.kind == b"moof").count(),
            fragments
        );
        assert!(top.iter().all(|atom| &atom.kind != b"mfra"));
        let definitions = tracks(*unique(&top, b"moov").unwrap()).unwrap();
        for (index, (at, moof)) in top
            .iter()
            .enumerate()
            .filter(|(_, atom)| &atom.kind == b"moof")
            .enumerate()
        {
            let index = index as u32;
            let parts = children(*moof).unwrap();
            let sequence = u32_at(unique(&parts, b"mfhd").unwrap().payload, 4).unwrap();
            assert_eq!(sequence, index + 1);
            let mdat = top[at + 1];
            assert_eq!(mdat.kind, *b"mdat");
            assert_eq!(mdat.payload, &(1..=11u8).collect::<Vec<_>>());
            for traf in parts.iter().filter(|atom| &atom.kind == b"traf") {
                let fields = children(*traf).unwrap();
                let header =
                    fragment_header(*unique(&fields, b"tfhd").unwrap(), &definitions).unwrap();
                assert_eq!(header.base, Some(moof.start as u64));
                let tfdt = *unique(&fields, b"tfdt").unwrap();
                assert_eq!(full(tfdt).unwrap(), (1, 0));
                assert_eq!(
                    u64_at(tfdt.payload, 4).unwrap(),
                    u64::from(index) * if header.track == 1 { 30 } else { 21 }
                );
                let parsed = run(
                    *unique(&fields, b"trun").unwrap(),
                    &header,
                    header.base.unwrap(),
                    None,
                )
                .unwrap();
                let offset = if header.track == 1 { 0 } else { 5 };
                assert_eq!(parsed.start, (mdat.start + mdat.header + offset) as u64);
                assert_eq!(
                    &bytes[parsed.start as usize..parsed.end as usize],
                    if header.track == 1 {
                        &[1, 2, 3, 4, 5][..]
                    } else {
                        &[6, 7, 8, 9, 10, 11][..]
                    }
                );
            }
        }
    }
    #[test]
    fn relocates_absolute_bases_and_keeps_both_tracks() {
        let joined = join(vec![
            segment(false, false),
            segment(false, false),
            segment(false, false),
        ])
        .unwrap();
        assert_continuous(&joined, 3);
    }
    #[test]
    fn handles_implicit_data_bases_and_extended_mdat_headers() {
        let joined = join(vec![segment(true, true), segment(true, true)]).unwrap();
        assert_continuous(&joined, 2);
    }
    #[test]
    fn rejects_different_init_external_references_and_missing_fragments() {
        let good = segment(false, false);
        let mut other = good.clone();
        let codec = other.windows(4).position(|bytes| bytes == b"hvc1").unwrap();
        other[codec..codec + 4].copy_from_slice(b"avc1");
        assert!(join(vec![good.clone(), other]).is_err());
        let mut external = good.clone();
        let url = external
            .windows(4)
            .position(|bytes| bytes == b"url ")
            .unwrap();
        external[url + 7] = 0;
        assert!(join(vec![external]).is_err());
        assert!(join(vec![init()]).is_err());
        assert!(join(Vec::new()).is_err());
    }
    #[test]
    fn merges_same_codec_configurations_and_maps_each_fragment_description() {
        let original = segment(false, false);
        let mut changed = original.clone();
        let hvc = changed
            .windows(4)
            .position(|bytes| bytes == b"hvcC")
            .unwrap();
        // Synthetic hvcC profile changes preserve the codec/container shape.
        changed[hvc + 5] = 2;
        let tkhd = changed
            .windows(4)
            .position(|bytes| bytes == b"tkhd")
            .unwrap();
        changed[tkhd + 4 + 76..tkhd + 4 + 80].copy_from_slice(&(1920u32 << 16).to_be_bytes());
        changed[tkhd + 4 + 80..tkhd + 4 + 84].copy_from_slice(&(1080u32 << 16).to_be_bytes());
        let joined = join(vec![original.clone(), changed, original]).unwrap();
        assert_continuous(&joined, 3);
        let top = atoms(&joined, 0).unwrap();
        let movie = *unique(&top, b"moov").unwrap();
        assert_eq!(tracks(movie).unwrap()[&1].descriptions, 2);
        assert_eq!(tracks(movie).unwrap()[&2].descriptions, 1);
        let mut seen = Vec::new();
        for moof in top.iter().filter(|atom| &atom.kind == b"moof") {
            for traf in children(*moof)
                .unwrap()
                .iter()
                .filter(|atom| &atom.kind == b"traf")
            {
                let fields = children(*traf).unwrap();
                let header =
                    fragment_header(*unique(&fields, b"tfhd").unwrap(), &tracks(movie).unwrap())
                        .unwrap();
                if header.track == 1 {
                    seen.push(header.description);
                }
            }
        }
        assert_eq!(seen, [1, 2, 1]);
    }
    #[test]
    fn rejects_offsets_outside_mdat_and_truncated_or_zero_atoms() {
        let mut outside = segment(false, false);
        let trun = outside
            .windows(4)
            .position(|bytes| bytes == b"trun")
            .unwrap();
        outside[trun + 12..trun + 16].copy_from_slice(&i32::MAX.to_be_bytes());
        assert!(join(vec![outside]).is_err());
        let good = segment(false, false);
        for end in [1, 7, good.len() - 1] {
            assert!(join(vec![good[..end].to_vec()]).is_err());
        }
        let mut zero = good;
        zero[..4].fill(0);
        assert!(join(vec![zero]).is_err());
    }
    #[test]
    fn rejects_overlapping_tracks_and_unknown_fragment_encryption() {
        let mut overlap = segment(false, false);
        let positions: Vec<_> = overlap
            .windows(4)
            .enumerate()
            .filter_map(|(at, bytes)| (bytes == b"trun").then_some(at))
            .collect();
        let first = overlap[positions[0] + 12..positions[0] + 16].to_vec();
        overlap[positions[1] + 12..positions[1] + 16].copy_from_slice(&first);
        assert!(join(vec![overlap]).is_err());
        let mut encryption = segment(false, false);
        let tfdt = encryption
            .windows(4)
            .position(|bytes| bytes == b"tfdt")
            .unwrap();
        encryption[tfdt..tfdt + 4].copy_from_slice(b"senc");
        assert!(join(vec![encryption]).is_err());
    }
}
