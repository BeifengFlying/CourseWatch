import { describe, it, expect, vi } from "vitest";
import { StudyConfig, ModelEndpoint, STUDY_NOTICE_VERSION, studyPageKind, validateStudyAnswer, type StudyQuestion } from "../packages/contracts/src/study.js";
import { answerQuestion } from "../packages/study/src/model.js";
const q: StudyQuestion = { id: "one", stem: "单选题：选择 2", type: "single", options: ["1", "2"], slots: 1 };
const config = StudyConfig.parse({ enabled: true, noticeVersion: STUDY_NOTICE_VERSION, model: "fixture-model" });
describe("自动学习边界与模型输出", () => {
  it("默认关闭；基础地址拒绝凭据、HTTP及查询参数，完整请求路径归一化", () => {
    expect(StudyConfig.parse({}).enabled).toBe(false);
    for (const url of ["http://api.example", "https://key@api.example", "https://api.example/v1?key=bad"]) expect(ModelEndpoint.safeParse(url).success).toBe(false);
    expect(ModelEndpoint.parse("https://api.example/v1/")).toBe("https://api.example/v1");
    expect(ModelEndpoint.parse("https://api.example/v1/chat/completions/")).toBe("https://api.example/v1");
    expect(ModelEndpoint.parse("https://api.example/custom/models")).toBe("https://api.example/custom");
  });
  it("只有官方章节可写，课程作业、考试、登录及伪造域名分别识别", () => {
    expect(studyPageKind("https://mooc2-ans.chaoxing.com/mycourse/studentstudy?chapterId=1")).toBe("chapter");
    expect(studyPageKind("https://mooc1.chaoxing.com/mooc-ans/work/doHomeWorkNew?x=1")).toBe("homework");
    expect(studyPageKind("https://mooc1.chaoxing.com/exam/phone/doExam")).toBe("exam");
    expect(studyPageKind("https://passport2.chaoxing.com/login")).toBe("login");
    for (const url of ["https://mooc1.chaoxing.com.evil.example/mycourse/studentstudy", "https://evil.example/mycourse/studentstudy", "https://mooc1.chaoxing.com/%ZZ"]) expect(studyPageKind(url)).toBe("other");
  });
  it("选项越界、重复、多余答案和缺失填空均不进入填答", () => {
    for (const answers of [["3"], ["1", "2"], [], ["B"]]) expect(() => validateStudyAnswer(q, { answers })).toThrow();
    expect(() => validateStudyAnswer({ ...q, type: "multiple" }, { answers: ["1", "1"] })).toThrow();
    expect(() => validateStudyAnswer({ ...q, type: "blank", slots: 2 }, { answers: ["one"] })).toThrow();
  });
  it("模型请求不携带平台会话，禁止重定向，并统计真实返回用量", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"answers":["2"],"explanation":"fixture"}' }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } })));
    const result = await answerQuestion(config, "fixture-key", q, new AbortController().signal, undefined, request);
    expect(result.answers).toEqual(["2"]); expect(result.inputTokens).toBe(10); expect(result.outputTokens).toBe(5);
    const [url, options] = request.mock.calls[0]; expect(url).toBe("https://api.deepseek.com/chat/completions"); expect(options.redirect).toBe("error"); expect(options.headers).not.toHaveProperty("Cookie");
  });
  it('提示词只要求结构化答案，不要求解释或操作步骤；纯答案响应可直接校验',async()=>{
    const request=vi.fn().mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:'{"answers":["2"]}'},finish_reason:'stop'}]})));
    const result=await answerQuestion(config,'fixture-key',q,new AbortController().signal,undefined,request);
    expect(result).toMatchObject({answers:['2'],explanation:''});
    const messages=JSON.parse(request.mock.calls[0][1].body).messages;
    expect(messages[0].content).toContain('仅输出答案 JSON：{"answers":["答案"]}');
    expect(messages[0].content).toContain('不要输出 explanation');
    expect(messages[0].content).not.toContain('"explanation":"解释"');
  });
  it("限流不自动重复收费；截断与非结构答案被拒绝", async () => {
    const request = vi.fn().mockResolvedValue(new Response("{}", { status: 429 }));
    await expect(answerQuestion(config, "fixture-key", q, new AbortController().signal, undefined, request)).rejects.toThrow("限流"); expect(request).toHaveBeenCalledTimes(1);
    for (const choice of [{ message: { content: '{"answers":["2"]}' }, finish_reason: "length" }, { message: { content: "答案 B" } }]) {
      const mock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [choice] })));
      await expect(answerQuestion(config, "fixture-key", q, new AbortController().signal, undefined, mock)).rejects.toThrow();
      expect(mock).toHaveBeenCalledTimes(1);
    }
  });
});
