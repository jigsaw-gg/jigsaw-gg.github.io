use bytes::{Buf, BufMut, Bytes, BytesMut};
use prost::Message;

use crate::proto::game::v1::StreamFrame;

pub fn encode_frame(frame: &StreamFrame) -> Bytes {
    let mut body = Vec::with_capacity(frame.encoded_len());
    frame
        .encode(&mut body)
        .expect("StreamFrame encode is infallible");
    let mut out = BytesMut::with_capacity(4 + body.len());
    out.put_u32(body.len() as u32);
    out.extend_from_slice(&body);
    out.freeze()
}

/// Incremental length-prefixed `StreamFrame` decoder.
#[derive(Default)]
pub struct FrameReader {
    buf: BytesMut,
}

impl FrameReader {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, data: &[u8]) {
        self.buf.extend_from_slice(data);
    }

    pub fn next_frame(&mut self) -> Result<Option<StreamFrame>, String> {
        if self.buf.len() < 4 {
            return Ok(None);
        }
        let mut len_bytes = &self.buf[..4];
        let len = len_bytes.get_u32() as usize;
        if len > 1_048_576 {
            return Err(format!("frame too large: {len}"));
        }
        if self.buf.len() < 4 + len {
            return Ok(None);
        }
        let _ = self.buf.split_to(4);
        let payload = self.buf.split_to(len);
        StreamFrame::decode(payload)
            .map(Some)
            .map_err(|err| err.to_string())
    }
}
