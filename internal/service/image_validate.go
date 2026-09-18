package service

import (
	"bufio"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
)

// ==================== 图片内容校验 ====================
//
// 部分数据源（典型如豆瓣）在识别到爬虫/风控时会返回 HTTP 200，响应体
// 却是 HTML 错误页或反爬脚本，这类内容一旦落盘就是无法解码的垃圾文件。
//
// 校验以内容嗅探为准而非 Content-Type：部分 CDN 会返回
// application/octet-stream，错误页也可能伪装成 image/*。

// imageHeaderSniffSize 需要读取的头部字节数（http.DetectContentType 的完整输入长度）
const imageHeaderSniffSize = 512

// looksLikeImage 判断数据是否是图片（标准库 MIME 嗅探）。
func looksLikeImage(data []byte) bool {
	return strings.HasPrefix(http.DetectContentType(data), "image/")
}

// openVerifiedImageBody 在写盘前校验响应体确实是图片。
//
// 返回的 reader 已经缓存在头部字节，后续 io.Copy 仍可读到完整内容，
// 因此调用方应在校验通过后再创建目标文件，校验失败时不会留下半截文件。
func openVerifiedImageBody(resp *http.Response) (*bufio.Reader, error) {
	if resp == nil || resp.Body == nil {
		return nil, fmt.Errorf("响应为空")
	}

	br := bufio.NewReader(resp.Body)
	head, err := br.Peek(imageHeaderSniffSize)
	if err != nil && err != io.EOF && err != bufio.ErrBufferFull {
		return nil, fmt.Errorf("读取图片响应失败: %w", err)
	}
	if !looksLikeImage(head) {
		return nil, fmt.Errorf("响应内容不是有效图片（Content-Type=%q，可能被反爬拦截或返回错误页）", resp.Header.Get("Content-Type"))
	}
	return br, nil
}

// isValidImageFile 校验本地文件是否为有效图片。
// 文件不存在、为空或不是图片时返回 false。
func isValidImageFile(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()

	head := make([]byte, imageHeaderSniffSize)
	n, err := io.ReadFull(f, head)
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		return false
	}
	return looksLikeImage(head[:n])
}
