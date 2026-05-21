import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boundaryTermsFor,
  compact,
  isCjk,
  isGenericTerm,
  isShortLatinTerm,
  termsFor,
} from "../src/text-match.ts";

test("termsFor extracts Latin word tokens with case folding", () => {
  const terms = termsFor("Send Mail Daily");
  assert.ok(terms.has("send"));
  assert.ok(terms.has("mail"));
  assert.ok(terms.has("daily"));
});

test("termsFor splits camelCase identifiers into their parts", () => {
  const terms = termsFor("createUser readUserList");
  assert.ok(terms.has("create"), "should expose 'create'");
  assert.ok(terms.has("user"), "should expose 'user'");
  assert.ok(terms.has("read"), "should expose 'read'");
  assert.ok(terms.has("list"), "should expose 'list'");
});

test("termsFor splits snake_case and kebab-case identifiers", () => {
  const snake = termsFor("create_user_profile");
  assert.ok(snake.has("create_user_profile"));
  assert.ok(snake.has("create"));
  assert.ok(snake.has("user"));
  assert.ok(snake.has("profile"));

  const kebab = termsFor("create-user-profile");
  assert.ok(kebab.has("create-user-profile"));
  assert.ok(kebab.has("create"));
  assert.ok(kebab.has("user"));
  assert.ok(kebab.has("profile"));
});

test("termsFor captures URLs as one token and exposes path parts", () => {
  const terms = termsFor("see https://example.com/api/v1/users for details");
  assert.ok(terms.has("https://example.com/api/v1/users"), "full URL stays as one token");
  // The URL is also split on `:+./-_` boundaries to surface every meaningful part.
  assert.ok(terms.has("https"));
  assert.ok(terms.has("example"));
  assert.ok(terms.has("com"));
  assert.ok(terms.has("api"));
  assert.ok(terms.has("v1"));
  assert.ok(terms.has("users"));
});

test("termsFor n-grams Chinese phrases into 2- and 3-character tokens", () => {
  const terms = termsFor("飞书发邮件");
  // The whole CJK run is preserved while it remains <= 8 characters.
  assert.ok(terms.has("飞书发邮件"));
  // 2-grams cover every adjacent pair.
  assert.ok(terms.has("飞书"));
  assert.ok(terms.has("书发"));
  assert.ok(terms.has("发邮"));
  assert.ok(terms.has("邮件"));
  // 3-grams cover every adjacent triple.
  assert.ok(terms.has("飞书发"));
  assert.ok(terms.has("书发邮"));
  assert.ok(terms.has("发邮件"));
});

test("termsFor exposes single CJK character runs as standalone tokens", () => {
  const terms = termsFor("用 ai");
  assert.ok(terms.has("用"));
  assert.ok(terms.has("ai"));
});

test("termsFor handles mixed CJK and Latin input", () => {
  const terms = termsFor("通过 Kibana console API 执行 ES DSL");
  assert.ok(terms.has("kibana"));
  assert.ok(terms.has("console"));
  assert.ok(terms.has("api"));
  assert.ok(terms.has("es"));
  assert.ok(terms.has("dsl"));
  assert.ok(terms.has("通过"));
  assert.ok(terms.has("执行"));
});

test("termsFor drops single-letter Latin tokens", () => {
  const terms = termsFor("a b c1 ab");
  assert.ok(!terms.has("a"));
  assert.ok(!terms.has("b"));
  // Length-2 tokens stay.
  assert.ok(terms.has("c1"));
  assert.ok(terms.has("ab"));
});

test("boundaryTermsFor does not split camelCase identifiers", () => {
  const terms = boundaryTermsFor("createUser openAi");
  // The whole compounded word stays joined because no camelCase pre-split runs.
  assert.ok(terms.has("createuser"));
  assert.ok(terms.has("openai"));
  // Inner parts must not surface — that is what termsFor is for.
  assert.ok(!terms.has("create"));
  assert.ok(!terms.has("user"));
  assert.ok(!terms.has("open"));
  assert.ok(!terms.has("ai"));
});

test("boundaryTermsFor preserves explicit punctuation boundaries", () => {
  const terms = boundaryTermsFor("use ai for daily reports");
  // `ai` appears as a standalone token because spaces are real boundaries.
  assert.ok(terms.has("ai"));
  assert.ok(terms.has("use"));
  assert.ok(terms.has("daily"));
  assert.ok(terms.has("reports"));
});

test("compact strips whitespace and punctuation while case-folding", () => {
  assert.equal(compact("Hello, World!"), "helloworld");
  assert.equal(compact("飞书 邮件 / mail"), "飞书邮件mail");
  assert.equal(compact("   "), "");
  assert.equal(compact("API v1.2"), "apiv12");
});

test("isCjk identifies pure CJK runs only", () => {
  assert.equal(isCjk("飞书"), true);
  assert.equal(isCjk("邮件"), true);
  assert.equal(isCjk("飞书mail"), false);
  assert.equal(isCjk("mail"), false);
  assert.equal(isCjk(""), false);
});

test("isShortLatinTerm flags <=3-char Latin/digit tokens", () => {
  assert.equal(isShortLatinTerm("ai"), true);
  assert.equal(isShortLatinTerm("tcc"), true);
  assert.equal(isShortLatinTerm("a1"), true);
  assert.equal(isShortLatinTerm("mail"), false);
  assert.equal(isShortLatinTerm("飞书"), false);
  assert.equal(isShortLatinTerm("AI"), false, "case must be normalised before checking");
});

test("isGenericTerm flags the canonical metadata-route stop list", () => {
  // Latin generic terms from metadata-route.
  assert.equal(isGenericTerm("api"), true);
  assert.equal(isGenericTerm("workflow"), true);
  assert.equal(isGenericTerm("management"), true);
  assert.equal(isGenericTerm("helper"), true);
  assert.equal(isGenericTerm("tool"), true);
  assert.equal(isGenericTerm("tools"), true);
  // CJK stop terms.
  assert.equal(isGenericTerm("工具"), true);
  assert.equal(isGenericTerm("查询"), true);
  assert.equal(isGenericTerm("管理"), true);
  // Distinctive tokens are NOT generic.
  assert.equal(isGenericTerm("elasticsearch"), false);
  assert.equal(isGenericTerm("bytedance"), false);
  assert.equal(isGenericTerm("飞书"), false);
  // Short Latin tokens such as `ai` / `es` carry distinct meaning when they
  // are real aliases, so they stay non-generic. Length-based filtering
  // happens at the call site via `isShortLatinTerm` when boundary matching
  // is required.
  assert.equal(isGenericTerm("ai"), false);
  assert.equal(isGenericTerm("es"), false);
  // Common English stop words like `the` / `and` / `for` are not in the
  // canonical metadata-route list — distinctiveness for those is handled by
  // the scoring side (low IDF, low contribution) rather than by
  // classification.
  assert.equal(isGenericTerm("the"), false);
  assert.equal(isGenericTerm("and"), false);
  assert.equal(isGenericTerm("for"), false);
});
