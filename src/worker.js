// WebLLM's engine runs here so that model loading and token generation never
// block the main thread — a stuttering Windows 95 window would break the spell
// faster than any wrong pixel.
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg) => handler.onmessage(msg);
