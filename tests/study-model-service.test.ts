import { it, expect, vi } from 'vitest';
import { inspectModelService } from '../packages/study/src/model-service.js';
it('读取服务商实际模型 ID，保留自定义路径，去重并过滤无效结果',async()=>{
 const request=vi.fn().mockResolvedValue(new Response(JSON.stringify({data:[{id:'deepseek-chat'},{id:'provider/model-v2'},{id:'deepseek-chat'},{id:''},{name:'not an id'}]})));
 expect(await inspectModelService('https://model.example/api/v1/chat/completions','fixture-key',undefined,request)).toEqual({models:['deepseek-chat','provider/model-v2']});
 const [url,options]=request.mock.calls[0];expect(url).toBe('https://model.example/api/v1/models');expect(options.method).toBe('GET');expect(options.redirect).toBe('error');expect(options.headers).not.toHaveProperty('Cookie');
});
it('测试使用填写的模型，不用列表返回值推断模型的可调用权限',async()=>{
 const request=vi.fn().mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:'OK'}}]})));
 expect(await inspectModelService('https://model.example/v1','fixture-key','model-full-id',request)).toEqual({model:'model-full-id',message:'模型连接成功'});
 expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({model:'model-full-id',stream:false});
});
it('区分认证、地址、额度、HTML网页及未支持模型列表，不泄露响应正文或自动重试',async()=>{
 for(const [response,reason] of [[new Response('secret-fixture',{status:401}),'Key'],[new Response('secret-fixture',{status:404}),'不存在'],[new Response('secret-fixture',{status:429}),'限流'],[new Response('<html>secret-fixture</html>'),'JSON'],[new Response('{"models":[]}'),'未返回模型列表']] as const){
  const request=vi.fn().mockResolvedValue(response);await expect(inspectModelService('https://model.example','fixture-key',undefined,request)).rejects.toThrow(reason);expect(request).toHaveBeenCalledTimes(1);
 }
});
