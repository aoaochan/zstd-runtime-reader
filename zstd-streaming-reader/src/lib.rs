use wasm_bindgen::prelude::*;
use web_sys::console;
use std::io::{Read, Cursor};
use serde::{Serialize, Deserialize};
use anyhow::Result;
use js_sys::Uint8Array;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileEntry {
    pub path: String,
    pub size: u64,
}

#[wasm_bindgen]
pub struct ZstdReader {
    decoder: Box<dyn Read>,
    file_list: Option<Vec<FileEntry>>,
}

#[wasm_bindgen]
impl ZstdReader {
    #[wasm_bindgen(constructor)]
    pub fn new(data: &[u8]) -> Result<ZstdReader, JsValue> {
        let cursor = Cursor::new(data.to_vec());
        let decoder = zstd::Decoder::new(cursor)
            .map_err(|e| JsValue::from_str(&format!("디코더 생성 실패: {}", e)))?;
        
        Ok(ZstdReader { 
            decoder: Box::new(decoder),
            file_list: None,
        })
    }

    #[wasm_bindgen]
    pub fn get_file_list(&mut self) -> Result<JsValue, JsValue> {
        if let Some(file_list) = &self.file_list {
            return Ok(serde_wasm_bindgen::to_value(file_list)
                .map_err(|e| JsValue::from_str(&format!("JS 변환 실패: {}", e)))?);
        }

        let mut file_list_line = Vec::new();
        let mut byte = [0u8];
        
        // 개행 문자를 만날 때까지 읽기
        while self.decoder.read_exact(&mut byte).is_ok() {
            if byte[0] == b'\n' {
                break;
            }
            file_list_line.push(byte[0]);
        }
        
        let file_list_str = String::from_utf8(file_list_line)
            .map_err(|e| JsValue::from_str(&format!("UTF-8 디코딩 실패: {}", e)))?;
        
        let files: Vec<FileEntry> = serde_json::from_str(&file_list_str)
            .map_err(|e| JsValue::from_str(&format!("파일 목록 파싱 실패: {}", e)))?;
        
        self.file_list = Some(files.clone());
        
        Ok(serde_wasm_bindgen::to_value(&files)
            .map_err(|e| JsValue::from_str(&format!("JS 변환 실패: {}", e)))?)
    }

    #[wasm_bindgen]
    pub fn extract_file(&mut self, path: &str) -> Result<Uint8Array, JsValue> {
        // 파일 목록이 없으면 먼저 읽기
        if self.file_list.is_none() {
            self.get_file_list()?;
        }
        
        let files = self.file_list.as_ref()
            .ok_or_else(|| JsValue::from_str("파일 목록을 찾을 수 없음"))?;
        
        // 요청된 파일 찾기
        let target_file = files.iter()
            .find(|f| f.path == path)
            .ok_or_else(|| JsValue::from_str(&format!("파일을 찾을 수 없음: {}", path)))?;
        
        log(&format!("파일 크기: {} 바이트", target_file.size));
        
        // 파일 데이터 읽기
        let mut file_data = vec![0u8; target_file.size as usize];
        match self.decoder.read_exact(&mut file_data) {
            Ok(_) => {
                log(&format!("파일 데이터 읽기 성공: {} 바이트", file_data.len()));
                // 처음 16바이트 출력
                let preview: Vec<String> = file_data.iter()
                    .take(16)
                    .map(|b| format!("{:02x}", b))
                    .collect();
                log(&format!("파일 데이터 미리보기: {}", preview.join(" ")));
                
                // RIFF 시그니처 찾기
                if let Some(riff_pos) = file_data.windows(4).position(|w| w == b"RIFF") {
                    log(&format!("RIFF 시그니처 위치: {}", riff_pos));
                    
                    // RIFF 헤더 이후 데이터 확인
                    if riff_pos + 8 < file_data.len() {
                        let webp_pos = riff_pos + 8;
                        let webp_data = &file_data[webp_pos..webp_pos + 4];
                        log(&format!("WEBP FourCC: {:02x} {:02x} {:02x} {:02x}", 
                            webp_data[0], webp_data[1], webp_data[2], webp_data[3]));
                        
                        // VP8X 청크 찾기
                        if let Some(vp8x_pos) = file_data[riff_pos + 12..].windows(4).position(|w| w == b"VP8X") {
                            log(&format!("VP8X 청크 위치: {}", vp8x_pos));
                            
                            // VP8X 청크 크기 읽기
                            let vp8x_size_pos = riff_pos + 12 + vp8x_pos + 4;
                            let vp8x_size = u32::from_le_bytes([
                                file_data[vp8x_size_pos],
                                file_data[vp8x_size_pos + 1],
                                file_data[vp8x_size_pos + 2],
                                file_data[vp8x_size_pos + 3],
                            ]);
                            log(&format!("VP8X 청크 크기: {} 바이트", vp8x_size));
                            
                            // VP8X 청크 데이터 출력
                            let vp8x_data_start = vp8x_size_pos + 4;
                            let vp8x_data_end = vp8x_data_start + vp8x_size as usize;
                            if vp8x_data_end <= file_data.len() {
                                let vp8x_data = &file_data[vp8x_data_start..vp8x_data_end];
                                let vp8x_preview: Vec<String> = vp8x_data.iter()
                                    .take(16)
                                    .map(|b| format!("{:02x}", b))
                                    .collect();
                                log(&format!("VP8X 청크 데이터: {}", vp8x_preview.join(" ")));
                            }
                        }
                        
                        // VP8 청크 찾기
                        if let Some(vp8_pos) = file_data[riff_pos + 12..].windows(4).position(|w| w == b"VP8 ") {
                            log(&format!("VP8 청크 위치: {}", vp8_pos));
                            
                            // VP8 청크 크기 읽기
                            let vp8_size_pos = riff_pos + 12 + vp8_pos + 4;
                            let vp8_size = u32::from_le_bytes([
                                file_data[vp8_size_pos],
                                file_data[vp8_size_pos + 1],
                                file_data[vp8_size_pos + 2],
                                file_data[vp8_size_pos + 3],
                            ]);
                            log(&format!("VP8 청크 크기: {} 바이트", vp8_size));
                            
                            // VP8 청크 데이터 출력
                            let vp8_data_start = vp8_size_pos + 4;
                            let vp8_data_end = vp8_data_start + vp8_size as usize;
                            if vp8_data_end <= file_data.len() {
                                let vp8_data = &file_data[vp8_data_start..vp8_data_end];
                                let vp8_preview: Vec<String> = vp8_data.iter()
                                    .take(16)
                                    .map(|b| format!("{:02x}", b))
                                    .collect();
                                log(&format!("VP8 청크 데이터: {}", vp8_preview.join(" ")));
                            }
                        }
                    }
                }
            },
            Err(e) => {
                log(&format!("파일 데이터 읽기 실패: {}", e));
                return Err(JsValue::from_str(&format!("파일 데이터 읽기 실패: {}", e)));
            }
        }
        
        // Uint8Array로 변환
        let array = Uint8Array::new_with_length(file_data.len() as u32);
        array.copy_from(&file_data);
        
        Ok(array)
    }
}

// 디버깅을 위한 유틸리티 함수
#[wasm_bindgen]
pub fn log(s: &str) {
    console::log_1(&JsValue::from_str(s));
}

pub fn add(left: u64, right: u64) -> u64 {
    left + right
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_works() {
        let result = add(2, 2);
        assert_eq!(result, 4);
    }
}
