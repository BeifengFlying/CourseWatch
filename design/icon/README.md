# CourseWatch 图标

可编辑源文件：[AppIcon.icon](../../apps/macos/AppIcon.icon)。画布为 1024 × 1024；C 形圆弧和时针分别为已展开描边的 SVG 填充轮廓。素材没有圆角蒙版、阴影、倒角或高光。背景颜色、渐变及材质配置保存在 `icon.json`，由 Apple Icon Composer 渲染。

圆弧向右开口，指针也朝右下方延伸。为调整视觉重心，圆弧与指针在 `icon.json` 中一起向左平移 28 pt，保持两者的相对位置。调整时检查 16、24、32、64 和 256 px 的显示效果。

`exports/macos-*.png` 为 Apple `ictool` 的默认、深色和着色外观导出图，不是可随系统实时变化的分层资源。`exports/legacy-*.png` 将官方渲染结果置于透明画布，供 macOS 14/15 的 `.icns` 使用；824 px 的显示区域用于保留已确认的视觉尺寸，不作为新版图标的画布要求。兼容图已转换为 sRGB。

安装 Icon Composer 后运行 `npm run build:icon` 可重新生成预览及兼容图；非默认安装位置可通过 `COURSEWATCH_ICTOOL` 指定其 `Contents/Executables/ictool`。普通应用构建使用已导出的兼容 PNG，不要求安装 Icon Composer。

当前已验证：Apple Icon Composer 1.0（56）的渲染器能读取工程并导出四种外观；`.icns` 包含 16、32、128、256、512 点及各自的 2x 图像。

当前系统为 macOS 15.7.4，仅安装 Command Line Tools，缺少 Xcode 的 `actool`。现有应用构建仍为静态 `.icns`，未编译新版动态 `Assets.car`。要在新系统上启用分层图标，需在支持 Icon Composer 的 Xcode 中将此 `.icon` 工程加入应用目标，并将 App Icon 设为 `AppIcon`，再进行系统运行验证。PNG 导出图与未经编译的 `.icon` 副本仅作为素材保留，动态图标接入需完成编译与系统运行验证。

依据：[App icons](https://developer.apple.com/design/human-interface-guidelines/app-icons)、[Creating your app icon using Icon Composer](https://developer.apple.com/documentation/xcode/creating-your-app-icon-using-icon-composer)。
