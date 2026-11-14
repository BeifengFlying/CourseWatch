import { createApp, h } from "vue";
createApp({
  render: () =>
    h(
      "div",
      {
        style:
          "width:280px;padding:20px;font:14px system-ui;background:#f5f7f5;color:#193b32",
      },
      [
        h("h2", "CourseWatch"),
        h("p", "后台独立运行，打开任务中心查看连接与采集状态。"),
        h(
          "button",
          {
            style: "padding:10px 20px;cursor:pointer",
            onClick: () => window.open("../dashboard.html"),
          },
          "打开任务中心",
        ),
      ],
    ),
}).mount("#app");
