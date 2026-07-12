import Fastify from "fastify";

const app = Fastify({ logger: true });
const port = Number(process.env.FAKE_PROVIDER_PORT ?? 19088);
const delayMs = Number(process.env.FAKE_PROVIDER_DELAY_MS ?? 80);
const imagePolls = new Map<string, number>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.post("/v1/chat/completions", async (_request, reply) => {
  await sleep(delayMs);
  await reply.send({
    id: "chatcmpl_fake",
    object: "chat.completion",
    choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }]
  });
});

app.post("/v1/responses", async (request, reply) => {
  const body = request.body as Record<string, unknown>;
  if (body.stream === true) {
    reply.raw.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
    for (let i = 0; i < 5; i += 1) {
      reply.raw.write(`event: response.output_text.delta\ndata: ${JSON.stringify({ delta: `chunk-${i}` })}\n\n`);
      await sleep(20);
    }
    reply.raw.write("data: [DONE]\n\n");
    reply.raw.end();
    return reply;
  }
  await sleep(delayMs);
  await reply.send({ id: "resp_fake", object: "response", output_text: "ok" });
});

app.post("/v1/messages", async (_request, reply) => {
  await sleep(delayMs);
  await reply.send({ id: "msg_fake", type: "message", role: "assistant", content: [{ type: "text", text: "ok" }] });
});

app.post("/api/tasks/navos-gpt-image-t2i", async (_request, reply) => {
  const id = `img_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  imagePolls.set(id, 0);
  await reply.send({ code: 200, data: { task_id: id } });
});

app.get("/api/tasks/image/generations/:taskId", async (request, reply) => {
  const taskId = (request.params as { taskId: string }).taskId;
  const count = (imagePolls.get(taskId) ?? 0) + 1;
  imagePolls.set(taskId, count);
  if (count < 2) {
    await reply.send({ status: "running", data: [] });
    return;
  }
  await reply.send({ status: "succeeded", data: [{ url: `https://fake-oss.local/${taskId}.png`, b64_json: "aGVsbG8=" }] });
});

app.post("/api/tasks/navos-gpt-image-i2i", async (_request, reply) => {
  const id = `edit_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  imagePolls.set(id, 0);
  await reply.send({ code: 200, data: { task_id: id } });
});

app.get("/api/tasks/image/edits/:taskId", async (request, reply) => {
  const taskId = (request.params as { taskId: string }).taskId;
  await reply.send({ status: "succeeded", data: [{ url: `https://fake-oss.local/${taskId}.png` }] });
});

await app.listen({ host: "127.0.0.1", port });
