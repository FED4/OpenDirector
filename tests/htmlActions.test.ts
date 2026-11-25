import assert from "node:assert/strict";
import test from "node:test";
import { parseHtmlAction, htmlSource } from "../src/canvas/htmlActions.ts";
const message = (payload: unknown = {choice: "b"}) => ({
  type: "opendirector.action", version: 1, requestId: "a-1", action: "submit", payload,
});
test("HTML bridge accepts bounded data, rejects arbitrary targets and commands", () => {
  assert.deepEqual(parseHtmlAction(message())?.payload, {choice: "b"});
  for (const value of [null, message([]), message({value: NaN}), message({value: undefined}),
    message({value: "x".repeat(65537)}), {...message(), target: "foreign-node"},
    {...message(), action: "generate"}, {...message(), version: 2}, message(new Date()),
    message(JSON.parse('{"__proto__":{"polluted":true}}'))]) assert.equal(parseHtmlAction(value), null);
  let nested: unknown = {};
  for (let index = 0; index < 40; index++) nested = {nested};
  assert.equal(parseHtmlAction(message(nested)), null);
});
test("HTML output accepts one optional Markdown wrapper without stripping internal fences", () => {
  assert.equal(htmlSource('```html\n<h1>Hello</h1>\n```'), '<h1>Hello</h1>');
  assert.equal(htmlSource('<pre>```js</pre>'), '<pre>```js</pre>');
});

test("HTML interaction state is a business change and survives node serialization", async () => {
  const {sameNodeData, parseNodeData} = await import("../src/canvas/dataBoundary.ts");
  const {createNode} = await import("../src/canvas/model.ts");
  const node = createNode("text", {x:0, y:0}, {textFormat:"html", htmlState:{choice:"b"}});
  const next = {...node.data, htmlState:{choice:"c"}};
  assert.equal(sameNodeData(node.data, next), false);
  assert.equal(sameNodeData(node.data, {...node.data, textFormat:"markdown"}), false);
  const parsed = parseNodeData("text", JSON.parse(JSON.stringify(node.data)));
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.deepEqual(parsed.value.htmlState, {choice:"b"});
});
