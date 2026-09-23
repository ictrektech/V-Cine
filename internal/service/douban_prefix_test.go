package service

import "testing"

// 验证冒号前缀安全网的前缀提取：全/半角冒号、无冒号、冒号开头、前缀过短的边界。
func TestSplitColonPrefix(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
		ok   bool
	}{
		{name: "全角冒号-平台演绎副标题", in: "肖申克的救赎：重获新生", want: "肖申克的救赎", ok: true},
		{name: "半角冒号", in: "肖申克的救赎: 重获新生", want: "肖申克的救赎", ok: true},
		{name: "无冒号", in: "肖申克的救赎", want: "", ok: false},
		{name: "冒号在开头", in: ":重获新生", want: "", ok: false},
		{name: "前缀仅一个字符不重试", in: "X：副标题", want: "", ok: false},
		{name: "前缀带空格修剪", in: "  肖申克的救赎 ： 重获新生", want: "肖申克的救赎", ok: true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, ok := splitColonPrefix(c.in)
			if got != c.want || ok != c.ok {
				t.Fatalf("splitColonPrefix(%q) = (%q, %v)，期望 (%q, %v)", c.in, got, ok, c.want, c.ok)
			}
		})
	}
}
