#!/usr/bin/env python3
"""Generate the read-only HTTP catalogue from registered Gin handlers.

No runtime dependencies or secrets are loaded. Unknown service result shapes remain
native expressions instead of being presented as invented OpenAPI schemas.
"""
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

def block(text, start):
    # Ignore quoted strings, raw strings and comments while matching Go braces.
    tokens = re.finditer(r'"(?:\\.|[^"\\])*"|`[^`]*`|\'(?:\\.|[^\'\\])*\'|//[^\n]*|/\*[\s\S]*?\*/|[{}]', text[start:])
    depth = 0
    for t in tokens:
        if t[0] == '{': depth += 1
        elif t[0] == '}':
            depth -= 1
            if depth == 0: return text[start:start+t.end()]
    raise ValueError('Unclosed Go block')

sources = {p: p.read_text() for p in (ROOT/'internal/handler').glob('*.go') if not p.name.endswith('_test.go')}
functions = {}
for p, text in sources.items():
    for m in re.finditer(r'func\s*\(\w+\s+\*(\w+)\)\s+(\w+)\([^\n]*\)\s*\{', text):
        functions[(m[1], m[2])] = (p, block(text, m.end()-1), text[:m.start()].count('\n')+1)
aggregate = (ROOT/'internal/handler/handler.go').read_text()
types = dict(re.findall(r'^\s*(\w+)\s+\*(\w+Handler)\s*$', aggregate,re.M))
main=(ROOT/'cmd/server/main.go').read_text()
groups=dict(re.findall(r'(\w+)\s*:=\s*r.Group\("([^"]+)"\)',main)); groups['r']=''
ops=[]
for m in re.finditer(r'^\s*(\w+)\.(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\("([^"]+)"\s*,([^\n]*)',main,re.M):
    group, method, route, tail=m.groups()
    if group not in groups: continue
    match=re.search(r'handlers\.(\w+)\.(\w+)',tail)
    path=groups[group]+route
    op={'method':method,'path':path,'access':'admin' if group=='admin' or 'AdminOnly' in tail else 'user' if group in ('api','authProtected') or 'jwtMiddleware' in tail else 'separate/public'}
    if match:
        handler=functions.get((types.get(match[1],''),match[2]))
        if handler:
            p,b,line=handler
            op['source']=str(p.relative_to(ROOT))+f'#L{line}'
            op['handler']=match[1]+'.'+match[2]
            op['parameters']=[{'in':kind,'name':name,'default':default or None} for kind,name,default in re.findall(r'c\.(Query|Param|PostForm|DefaultQuery|DefaultPostForm)\("([^"]+)"(?:,\s*"([^"]*)")?\)',b)]
            declarations=[]
            for d in re.finditer(r'var\s+(\w+)\s+(struct\s*\{|[\w.]+)',b):
                var,typ=d.groups()
                if re.search(r'(?:Bind|ShouldBind)\w*\(&'+re.escape(var)+r'\)',b):
                    declarations.append(block(b,d.end()-1) if typ.startswith('struct') else typ)
            op['request_types']=declarations
            op['responses']=[]
            for response in re.finditer(r'c\.(JSON|Status|Data|String|SSEvent|Stream|File|FileAttachment|Redirect)\(([^\n]*)',b):
                expression=response[2].strip()
                if 'gin.H{' in expression:
                    pos=b.find('gin.H{',response.start())+len('gin.H')
                    expression=expression.split('gin.H{')[0]+'gin.H'+block(b,pos)
                op['responses'].append({'kind':response[1],'native_expression':expression.rstrip(')')})
    ops.append(op)
# Include all named JSON structs for request/result fields referenced by handlers.
schemas=[]
for folder in ('internal/handler','internal/model'):
    for p in sorted((ROOT/folder).glob('*.go')):
        if p.name.endswith('_test.go'): continue
        text=p.read_text()
        for m in re.finditer(r'type\s+(\w+)\s+struct\s*\{',text):
            b=block(text,m.end()-1)
            if 'json:"' not in b: continue
            schemas.append({'name':m[1],'source':str(p.relative_to(ROOT)),'declaration':b})
out=ROOT/'web/public/api-catalogue.json';out.parent.mkdir(parents=True,exist_ok=True)
out.write_text(json.dumps({'operations':ops,'types':schemas},ensure_ascii=False,indent=2)+'\n')
print(f'{len(ops)} registered HTTP operations; {len(schemas)} native JSON types')
