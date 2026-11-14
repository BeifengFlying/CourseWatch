<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../lib/api";
import { desktopPlatform, sendDesktop } from "../lib/desktop";
import {
  defaultMobileNotifications,
  type MobileNotificationConfig,
  type PushDevice,
} from "../../../packages/contracts/src/mobile-notifications";
const config = ref<MobileNotificationConfig>(
  structuredClone(defaultMobileNotifications),
);
const saved = ref("");
const password = ref(""),
  clearPassword = ref(false),
  hasPassword = ref(false);
const busy = ref(false),
  ready = ref(false),
  message = ref(""),
  error = ref("");
const devices = ref<PushDevice[]>([]),
  deliveries = ref<any[]>([]);
const calendarStatus = ref<any>({ message: "尚未同步" });
const pairing = ref<{ url: string; code: string; qr: string } | null>(null);
const subscription = ref("");
const dirty = computed(
  () =>
    JSON.stringify(config.value) !== saved.value ||
    !!password.value ||
    clearPassword.value,
);
const isMac = desktopPlatform === "macos";
function apply(data: any) {
  config.value = data.config;
  saved.value = JSON.stringify(data.config);
  hasPassword.value = data.hasPassword;
  devices.value = data.devices;
  deliveries.value = data.deliveries;
  calendarStatus.value = data.calendarStatus;
  password.value = "";
  clearPassword.value = false;
  ready.value = true;
}
async function run(work: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  message.value = "";
  try {
    await work();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function load() {
  apply(await api("notification-channels"));
}
async function refreshStatus() {
  const data = await api("notification-channels");
  calendarStatus.value = data.calendarStatus;
  deliveries.value = data.deliveries;
}
async function save() {
  apply(
    await api("notification-channels", "PATCH", {
      config: config.value,
      ...(password.value ? { password: password.value } : {}),
      clearPassword: clearPassword.value,
    }),
  );
  pairing.value = null;
  if (isMac) sendDesktop("syncCalendar");
}
function preset(event: Event) {
  const name = (event.target as HTMLSelectElement).value;
  const hosts: Record<string, string> = {
    qq: "smtp.qq.com",
    "163": "smtp.163.com",
    "126": "smtp.126.com",
    icloud: "smtp.mail.me.com",
    gmail: "smtp.gmail.com",
  };
  if (hosts[name]) {
    config.value.email.host = hosts[name];
    config.value.email.port = name === "icloud" ? 587 : 465;
  }
}
async function test(channel: "email" | "web") {
  await run(async () => {
    if (dirty.value) await save();
    const result = await api("notification-channels/test", "POST", { channel });
    message.value = result.message;
  });
}
async function makePairing() {
  await run(async () => {
    if (dirty.value) await save();
    pairing.value = await api("notification-channels/pairing", "POST", {});
    message.value = "配对码 30 分钟内有效，一次只能连接一台设备。";
  });
}
async function importSubscription() {
  await run(async () => {
    let value;
    try {
      value = JSON.parse(subscription.value);
    } catch {
      throw new Error("订阅信息不是有效 JSON，请完整复制或导入文件");
    }
    apply(await api("notification-channels/devices", "POST", value));
    subscription.value = "";
    pairing.value = null;
    message.value = "设备已连接，请发送测试通知并在设备上核对。";
  });
}
async function readFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (file.size > 20000) {
    error.value = "订阅文件超过大小上限";
    return;
  }
  try {
    subscription.value = await file.text();
  } catch {
    error.value = "无法读取订阅文件，请重新选择";
  }
}
const statusName: Record<string, string> = {
  pending: "待重试",
  accepted: "服务已接收",
  failed: "发送失败",
  cancelled: "已取消",
};
onMounted(() => run(load));
</script>

<template>
  <section
    class="notification-channels"
    aria-label="手机通知设置"
    :aria-busy="busy"
  >
    <h3>手机通知</h3>
    <p class="channel-hint">
      邮件和网页推送由电脑发送，休眠或关机期间不发送。三个渠道分别开启、分别记录结果。
    </p>
    <p v-if="error" class="channel-feedback channel-error" role="alert">
      {{ error }}
    </p>
    <p v-if="message" class="channel-feedback" role="status">{{ message }}</p>
    <button v-if="!ready" type="button" :disabled="busy" @click="run(load)">
      重新读取通知设置
    </button>
    <fieldset v-if="ready" :disabled="busy">
      <details open>
        <summary>邮件通知</summary>
        <label class="channel-check"
          ><input
            type="checkbox"
            v-model="config.email.enabled"
          />开启邮件通知</label
        >
        <p class="channel-hint">
          必须使用两个不同邮箱：一个发送，一个接收。收件和手机提示可能受邮箱提供商及邮件客户端同步延迟影响。
        </p>
        <div class="channel-grid">
          <label
            >发件邮箱服务<select aria-label="发件邮箱服务" @change="preset">
              <option value="">自定义 SMTP</option>
              <option value="qq">QQ 邮箱</option>
              <option value="163">163 邮箱</option>
              <option value="126">126 邮箱</option>
              <option value="icloud">iCloud 邮箱</option>
              <option value="gmail">Gmail</option>
            </select></label
          >
          <label
            >SMTP 端口<select v-model.number="config.email.port">
              <option :value="465">465 · TLS</option>
              <option :value="587">587 · STARTTLS</option>
            </select></label
          >
          <label class="channel-wide"
            >SMTP 服务器<input
              v-model.trim="config.email.host"
              autocomplete="off"
              placeholder="例如 smtp.qq.com"
          /></label>
          <label
            >发件邮箱<input
              type="email"
              v-model.trim="config.email.from"
              autocomplete="off"
              @change="config.email.user ||= config.email.from"
          /></label>
          <label
            >收件邮箱<input
              type="email"
              v-model.trim="config.email.to"
              autocomplete="off"
          /></label>
          <label class="channel-wide"
            >SMTP 登录账号<input
              v-model.trim="config.email.user"
              autocomplete="off"
              placeholder="通常与发件邮箱相同"
          /></label>
          <label class="channel-wide"
            >SMTP 授权码或应用专用密码<input
              type="password"
              v-model="password"
              autocomplete="new-password"
              :placeholder="
                hasPassword
                  ? '已保存；留空保留，更换发件账号后需重新填写'
                  : '请在邮箱设置中开启 SMTP 并生成授权码'
              "
          /></label>
        </div>
        <p class="channel-hint">
          授权码加密保存在本机，不在界面回显。邮箱服务不支持 SMTP
          授权码时，请使用其要求的应用专用密码。
        </p>
        <label v-if="hasPassword" class="channel-check"
          ><input
            type="checkbox"
            v-model="clearPassword"
          />清除已保存的授权码（请先关闭邮件通知）</label
        >
        <div class="channel-actions">
          <button
            type="button"
            :disabled="!config.email.enabled"
            @click="test('email')"
          >
            测试邮件通知
          </button>
        </div>
      </details>
      <details open>
        <summary>网页推送 · iPhone／iPad／Android</summary>
        <label class="channel-check"
          ><input
            type="checkbox"
            v-model="config.web.enabled"
          />开启网页推送</label
        >
        <p class="channel-hint">
          iPhone／iPad 需要 iOS／iPadOS 16.4 或更新版本，用 Safari
          将订阅页添加到主屏幕后开启通知。Android 使用支持 Web Push
          的浏览器。推送服务和网络可能影响到达。
        </p>
        <div class="channel-grid">
          <label class="channel-wide"
            >HTTPS 订阅页地址<input
              type="url"
              v-model.trim="config.web.pageUrl"
              placeholder="https://你的域名/mobile-push/"
          /></label>
          <label class="channel-wide"
            >推送联系邮箱<input
              type="email"
              v-model.trim="config.web.contact"
              placeholder="供推送服务识别发送者，不用于发送邮件"
          /></label>
        </div>
        <p class="channel-hint">
          先将项目的 mobile-push 静态目录部署到 HTTPS
          站点，再填写地址。无需通知中转后端；普通局域网 HTTP
          页面不能用于手机订阅。
        </p>
        <div class="channel-actions">
          <button
            type="button"
            :disabled="!config.web.enabled"
            @click="makePairing"
          >
            生成手机配对码</button
          ><button
            type="button"
            :disabled="!config.web.enabled || !devices.length"
            @click="test('web')"
          >
            测试网页推送
          </button>
        </div>
        <div v-if="pairing" class="channel-pairing">
          <img
            :src="pairing.qr"
            alt="手机通知配对二维码"
            width="220"
            height="220"
          />
          <label
            >手机订阅链接<input
              :value="pairing.url"
              readonly
              @focus="($event.target as HTMLInputElement).select()"
          /></label>
          <label
            >配对码<textarea
              :value="pairing.code"
              readonly
              rows="3"
              @focus="($event.target as HTMLTextAreaElement).select()"
            ></textarea>
          </label>
          <p class="channel-hint">
            手机扫码后允许通知，将生成的订阅信息复制或保存文件传回电脑。iPhone／iPad
            添加到主屏幕后若配对码未保留，请手动粘贴。
          </p>
        </div>
        <label class="channel-field"
          >手机生成的订阅信息<textarea
            v-model="subscription"
            rows="4"
            spellcheck="false"
            placeholder="粘贴手机生成的 JSON，或选择订阅文件"
          ></textarea>
        </label>
        <label class="channel-field"
          >选择订阅文件<input
            type="file"
            accept="application/json,.json"
            @change="readFile"
        /></label>
        <div class="channel-actions">
          <button
            type="button"
            :disabled="!subscription.trim() || dirty"
            @click="importSubscription"
          >
            导入订阅信息
          </button>
        </div>
        <p v-if="dirty && subscription.trim()" class="channel-hint">
          请先保存设置；若更改了推送设置，需要重新生成配对码。
        </p>
        <ul v-if="devices.length" class="channel-devices">
          <li v-for="device in devices" :key="device.id">
            <span>{{ device.name }}</span
            ><button
              type="button"
              :aria-label="`移除设备 ${device.name}`"
              @click="
                run(async () => {
                  apply(
                    await api(
                      `notification-channels/devices/${device.id}/delete`,
                      'POST',
                      {},
                    ),
                  );
                  message = '设备已移除';
                })
              "
            >
              移除
            </button>
          </li>
        </ul>
      </details>
      <details>
        <summary>iCloud 日历 · 仅 macOS 桌面端</summary>
        <p class="channel-hint">
          在 Mac 的系统设置中登录 iCloud 并开启日历，同一 Apple 账号的
          iPhone／iPad 也需开启日历同步。CourseWatch
          只向专用日历写入任务与个人日程，不修改其他日历。
        </p>
        <label class="channel-check"
          ><input
            type="checkbox"
            v-model="config.calendar.enabled"
            :disabled="!isMac"
          />开启 iCloud 日历同步</label
        >
        <p class="channel-hint">
          需要授权读取和写入日历，用于更新及移除本应用创建的日程。已经同步的提醒在电脑关机后仍可能响起；关闭同步后需让
          Mac 再运行一次，清理已同步日程。iCloud 同步可能延迟。
        </p>
        <p v-if="!isMac" class="channel-hint">
          请在 CourseWatch 的 macOS 桌面应用中设置此项。
        </p>
        <p class="channel-hint" role="status">{{ calendarStatus.message }}</p>
        <div class="channel-actions">
          <button
            type="button"
            :disabled="!isMac || !config.calendar.enabled"
            @click="
              run(async () => {
                if (dirty) await save();
                sendDesktop('configureCalendar');
                message = '已请求系统日历授权；同步结果稍后可刷新查看';
              })
            "
          >
            授权并同步日历</button
          ><button type="button" @click="run(refreshStatus)">
            刷新同步状态
          </button>
        </div>
      </details>
      <div class="channel-actions channel-footer">
        <button
          type="button"
          class="channel-primary"
          :disabled="!dirty"
          @click="
            run(async () => {
              await save();
              message = '手机通知设置已保存';
            })
          "
        >
          保存手机通知设置</button
        ><button type="button" :disabled="!dirty" @click="run(load)">
          取消修改
        </button>
      </div>
      <details v-if="deliveries.length" class="channel-log">
        <summary>最近投递记录</summary>
        <ul>
          <li v-for="(item, index) in deliveries" :key="index">
            <span
              >{{ item.channel === "email" ? "邮件" : "网页推送" }} ·
              {{ item.title || "通知" }}</span
            ><span>{{ statusName[item.status] || item.status }}</span
            ><small v-if="item.error">{{ item.error }}</small>
          </li>
        </ul>
        <p class="channel-hint">
          “服务已接收”不表示手机已显示。记录最多显示最近 30 次投递。
        </p>
      </details>
    </fieldset>
  </section>
</template>

<style scoped>
.notification-channels {
  --channel-line: var(--d-line, var(--line, #8884));
  --channel-accent: var(--d-accent, var(--accent, #ac552e));
  --channel-input: var(--d-control, var(--panel, transparent));
  min-width: 0;
  margin: 24px 0;
  font-size: 14px;
  color: inherit;
}
.notification-channels h3 {
  margin: 0 0 10px;
  font-size: 17px;
}
.notification-channels fieldset {
  min-width: 0;
  border: 0;
  padding: 0;
  margin: 0;
}
.notification-channels details {
  border-top: 1px solid var(--channel-line);
  padding: 16px 0;
}
.notification-channels summary {
  font-weight: 600;
  cursor: pointer;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.channel-hint {
  font-size: 12px;
  line-height: 1.7;
  opacity: 0.76;
  margin: 10px 0;
  overflow-wrap: anywhere;
}
.channel-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin: 14px 0;
}
.channel-wide {
  grid-column: 1/-1;
}
.notification-channels label:not(.channel-check) {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  font-size: 13px;
  min-width: 0;
  text-align: left;
}
.notification-channels input:not([type="checkbox"]),
.notification-channels select,
.notification-channels textarea {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  min-height: 44px;
  border: 1px solid var(--channel-line);
  border-radius: 9px;
  padding: 10px 12px;
  font: inherit;
  background: var(--channel-input);
  color: inherit;
}
.notification-channels input[type="file"] {
  font-size: 12px;
}
.notification-channels textarea {
  resize: vertical;
  overflow-wrap: anywhere;
}
.channel-check {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 16px 0;
  min-height: 28px;
}
.channel-check input {
  width: 17px;
  height: 17px;
  margin: 0;
  accent-color: var(--channel-accent);
}
.channel-field {
  margin: 14px 0;
}
.channel-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 14px;
  align-items: center;
}
.notification-channels button {
  min-height: 44px;
  border-radius: 9px;
  padding: 10px 14px;
  border: 1px solid var(--channel-line);
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  white-space: normal;
  text-align: center;
}
.notification-channels button:disabled {
  opacity: 0.45;
  cursor: default;
}
.notification-channels .channel-primary {
  background: var(--channel-accent);
  color: #fff;
  border-color: transparent;
}
.channel-footer {
  padding: 16px 0;
  border-top: 1px solid var(--channel-line);
}
.channel-feedback {
  padding: 10px 12px;
  border: 1px solid var(--channel-line);
  border-radius: 9px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.channel-error {
  color: var(--danger, #b44c38);
}
.channel-pairing {
  display: grid;
  gap: 14px;
  margin-top: 18px;
  min-width: 0;
}
.channel-pairing img {
  max-width: 100%;
  height: auto;
  border-radius: 10px;
}
.channel-devices,
.channel-log ul {
  padding: 0;
  list-style: none;
}
.channel-devices li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
}
.channel-devices span {
  overflow-wrap: anywhere;
  min-width: 0;
}
.channel-log li {
  display: grid;
  gap: 6px;
  padding: 10px 0;
  border-bottom: 1px solid var(--channel-line);
  overflow-wrap: anywhere;
}
.channel-log small {
  opacity: 0.76;
  line-height: 1.6;
}
.notification-channels :focus-visible {
  outline: 3px solid var(--channel-accent);
  outline-offset: 3px;
}
@media (max-width: 560px) {
  .channel-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .channel-actions > button {
    flex: 1 1 140px;
  }
}
</style>
