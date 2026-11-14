import {it,expect,vi} from 'vitest';
import {answerQuestion} from '../packages/study/src/model.js';
import {StudyConfig} from '../packages/contracts/src/study.js';
const question={id:'1',stem:'选择第二项',type:'single' as const,options:['甲','乙'],slots:1};
function streaming(events:unknown[]){
 const bytes=new TextEncoder().encode(events.map(e=>'data: '+JSON.stringify(e)+'\r\n\r\n').join('')+'data: [DONE]\r\n\r\n');
 return new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=7)controller.enqueue(bytes.slice(i,i+7));controller.close();}}),{headers:{'content-type':'text/event-stream'}});
}
it('分片 SSE 先显示思考再显示答案，保留用量',async()=>{
 const updates:any[]=[];const request=vi.fn().mockResolvedValue(streaming([
  {choices:[{index:0,delta:{reasoning_content:'接口返回的思考摘要'}}]},
  {choices:[{index:0,delta:{content:'{"answers":["2"],'}}]},
  {choices:[{index:0,delta:{content:'"explanation":"选乙"}'},finish_reason:'stop'}],usage:{prompt_tokens:12,completion_tokens:18}}
 ]));
 const result=await answerQuestion(StudyConfig.parse({model:'fixture',reasoningEffort:'high'}),'key',question,new AbortController().signal,undefined,request,undefined,u=>updates.push(u));
 expect(result).toMatchObject({answers:['2'],inputTokens:12,outputTokens:18});expect(updates[0]).toEqual({reasoning:'接口返回的思考摘要',answer:''});expect(updates.at(-1).answer).toContain('选乙');
 expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({stream:true});expect(JSON.parse(request.mock.calls[0][1].body)).not.toHaveProperty('reasoning_effort');expect(request).toHaveBeenCalledTimes(1);
});
it('默认不传思考强度，JSON 回退没有思考内容就留空，不补造过程',async()=>{
 const progress=vi.fn(),request=vi.fn().mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:'{"answers":["2"]}'},finish_reason:'stop'}]})));
 await answerQuestion(StudyConfig.parse({model:'fixture'}),'key',question,new AbortController().signal,undefined,request,undefined,progress);
 expect(JSON.parse(request.mock.calls[0][1].body)).not.toHaveProperty('reasoning_effort');expect(progress).toHaveBeenCalledWith({reasoning:'',answer:'{"answers":["2"]}'});
});
it('流中断、无答案和超限均不提交、不重试付费请求',async()=>{
 for(const events of [[{choices:[{delta:{content:'{"answers":["2"]}'}}]}],[{choices:[{delta:{reasoning_content:'只有摘要'},finish_reason:'stop'}]}]]){
  const request=vi.fn().mockResolvedValue(streaming(events));
  await expect(answerQuestion(StudyConfig.parse({model:'fixture'}),'key',question,new AbortController().signal,undefined,request,undefined,vi.fn())).rejects.toThrow();expect(request).toHaveBeenCalledTimes(1);
 }
});
it('流式空答案重做时清空上次输出，第二次有效答案汇总用量',async()=>{
 const updates:any[]=[],retry=vi.fn();
 const request=vi.fn().mockResolvedValueOnce(streaming([
  {choices:[{index:0,delta:{reasoning_content:'首次返回的摘要',content:'{"answers":[]}'},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:4}}
 ])).mockResolvedValueOnce(streaming([
  {choices:[{index:0,delta:{content:'{"answers":["2"]}'},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:6}}
 ]));
 const result=await answerQuestion(StudyConfig.parse({model:'fixture'}),'key',question,new AbortController().signal,undefined,request,undefined,u=>updates.push(u),retry);
 expect(result).toMatchObject({answers:['2'],inputTokens:30,outputTokens:10});
 expect(request).toHaveBeenCalledTimes(2);expect(retry).toHaveBeenCalledTimes(1);
 expect(updates).toContainEqual({reasoning:'',answer:''});
 expect(updates.at(-1)).toEqual({reasoning:'',answer:'{"answers":["2"]}'});
});
it('两次流式空答案后联网，第三次流式答案仍按原解析校验并汇总用量',async()=>{
 const empty=()=>streaming([{choices:[{index:0,delta:{content:'{"answers":[]}'},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:4}}]);
 const request=vi.fn().mockResolvedValueOnce(empty()).mockResolvedValueOnce(empty())
  .mockResolvedValueOnce(new Response('<li class="b_algo"><h2><a href="https://reference.example/one">资料</a></h2><div class="b_caption"><p>乙与题目相符</p></div></li>'))
  .mockResolvedValueOnce(streaming([{choices:[{index:0,delta:{content:'{"answers":["2"]}'},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:6}}]));
 const updates:any[]=[],retry=vi.fn();
 const result=await answerQuestion(StudyConfig.parse({model:'fixture'}),'key',question,new AbortController().signal,undefined,request,undefined,u=>updates.push(u),retry);
 expect(result).toMatchObject({answers:['2'],inputTokens:40,outputTokens:14});
 expect(retry.mock.calls).toEqual([[2],[3]]);expect(request).toHaveBeenCalledTimes(4);
 expect(updates.filter(u=>u.answer===''&&u.reasoning==='')).toHaveLength(2);
 expect(updates.at(-1).answer).toBe('{"answers":["2"]}');
});
