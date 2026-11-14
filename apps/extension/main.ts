import { createApp } from "vue";
import App from "./components/App.vue";
import Desktop from "./components/Desktop.vue";
import "./desktop.css";
import "./style.css";
createApp(
  new URLSearchParams(location.search).has("desktop") ? Desktop : App,
).mount("#app");
