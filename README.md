# Sunny English Buddy

一个给中文母语孩子使用的英语陪练原型，包含：

- 日常英语对话
- 听力理解小题
- 单词记忆和复习
- Gemini Live WebSocket 连接
- 浏览器语音识别输入和英文朗读输出

## 使用

在项目目录启动一个静态服务器：

```bash
python3 -m http.server 5173
```

然后打开：

```text
http://127.0.0.1:5173
```

在页面里粘贴 Gemini API Key，点击“连接老师”，再点击“开始这一课”。

## 说明

这个原型为了方便本机试用，会把 API Key 存在当前浏览器的 `localStorage`。正式给孩子长期使用时，建议改成后端代理，不要把 key 暴露在浏览器里。
