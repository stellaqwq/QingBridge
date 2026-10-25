---
name: QQ AI Bot 本机管理台
description: 用清晰的中文工作台完成连接、配置、消息观察与排障。
colors:
  bg: "#f5f7f6"
  surface: "#fff"
  surface-muted: "#f0f4f2"
  ink: "#172c25"
  muted: "#5e7068"
  line: "#dce5df"
  accent: "#267456"
  accent-hover: "#1b5e44"
  accent-soft: "#e6f1eb"
  rail: "#183d30"
  rail-text: "#c1d6ca"
  ok: "#226b4d"
  warn: "#906115"
  warn-bg: "#fff5df"
  bad: "#b73737"
  bad-bg: "#fff0ef"
  nav-selected: "#d4ebd9"
  nav-selected-ink: "#193d2c"
  nav-hover: "#244b3b"
  field-line: "#72877b"
  field-line-hover: "#526e5f"
  focus: "#267456"
  focus-on-dark: "#b8dbc8"
typography:
  headline:
    fontFamily: "'Segoe UI Variable Text','Segoe UI','PingFang SC','Microsoft YaHei',system-ui,sans-serif"
    fontSize: "25px"
    fontWeight: 650
    lineHeight: 1.35
    letterSpacing: "-0.025em"
  title:
    fontFamily: "'Segoe UI Variable Text','Segoe UI','PingFang SC','Microsoft YaHei',system-ui,sans-serif"
    fontSize: "17px"
    fontWeight: 650
    lineHeight: 1.35
  panel-title:
    fontFamily: "'Segoe UI Variable Text','Segoe UI','PingFang SC','Microsoft YaHei',system-ui,sans-serif"
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1.35
  body:
    fontFamily: "'Segoe UI Variable Text','Segoe UI','PingFang SC','Microsoft YaHei',system-ui,sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "'Segoe UI Variable Text','Segoe UI','PingFang SC','Microsoft YaHei',system-ui,sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.6
  meta:
    fontFamily: "'Segoe UI Variable Text','Segoe UI','PingFang SC','Microsoft YaHei',system-ui,sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.6
  mono:
    fontFamily: "'Cascadia Code',Consolas,monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  tag: "5px"
  control: "7px"
  feedback: "8px"
  panel: "12px"
spacing:
  compact: "6px"
  action-gap: "8px"
  row-gap: "12px"
  group: "20px"
  panel-y: "22px"
  panel-x: "23px"
  field-gap: "24px"
  settings-panel: "25px"
  content-y: "32px"
  content-x: "36px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "7px 13px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "7px 13px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-muted}"
  button-danger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.bad}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "7px 13px"
  button-text:
    textColor: "{colors.accent}"
    rounded: "{rounded.control}"
    padding: "6px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "9px 11px"
  nav-item:
    textColor: "{colors.rail-text}"
    rounded: "{rounded.control}"
    padding: "11px 14px"
    width: "100%"
  nav-item-selected:
    backgroundColor: "{colors.nav-selected}"
    textColor: "{colors.nav-selected-ink}"
  tag:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.muted}"
    typography: "{typography.meta}"
    rounded: "{rounded.tag}"
    padding: "3px 8px"
  tag-ok:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.ok}"
  tag-warn:
    backgroundColor: "{colors.warn-bg}"
    textColor: "{colors.warn}"
  tag-bad:
    backgroundColor: "{colors.bad-bg}"
    textColor: "{colors.bad}"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
  pipeline:
    textColor: "{colors.ink}"
    padding: "25px 23px"
  operational-list:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
---

# Design System: QQ AI Bot 本机管理台

## Overview

**Creative North Star: "本机工作台"**

深松绿侧栏提供稳定的位置感，淡灰白工作区承载白色面板。中文标题、紧凑标签和分组表单服务于长时间查看配置、消息与运行记录；视觉重心落在连接情况和当前任务上。

采用已确认的本机中文管理台方向。控件表达直接、细节克制，运行流程与实际开关、队列状态相连。模拟环境、未保存、待重启和发送结果待核对都有明确文字。

**Key Characteristics:**
- 深色侧栏与浅色工作区形成清楚的空间分区。
- 中文系统字体、细边框和紧凑元数据保持操作密度。
- 消息接收、AI 生成、回复发送构成可点击的运行流程。
- 状态同时使用文字与颜色，保存和生效分开表达。

## Colors

色彩以低饱和的松绿和灰白为底，前置 token 是颜色值的唯一规范来源。

### Primary

- **操作绿**（`accent` / `accent-hover`）：主按钮、链接、勾选控件与流程图标；悬停加深。
- **浅绿选择面**（`accent-soft` / `nav-selected`）：设置选项与侧栏当前页；深松绿（`rail`）承载持续可见的导航。
- **状态绿**（`ok`）：已连接与完成状态，并配合明确状态文字。

### Neutral

- **灰白底与白面板**（`bg` / `surface`）：区分工作区和内容容器。
- **柔灰绿**（`surface-muted` / `line`）：表头、代码区域、次级按钮悬停与内容分隔。
- **深墨与次级字色**（`ink` / `muted`）：正文和说明；侧栏使用独立浅文字（`rail-text`）。
- 琥珀色（`warn` / `warn-bg`）用于警告、暂停与需要核对；红色（`bad` / `bad-bg`）用于失败和危险操作。

**The 状态有字 Rule.** 圆点、色块与边框都配合可读状态文字；颜色只辅助判断。

## Typography

正文和标题共用前置 `body` 的中文系统字体栈；变量名、地址与原始事件使用 `mono`。不依赖远程字体。字号层级围绕管理任务组织，日期与时间使用等宽数字。

- 页面标题使用 `headline`；窄屏（≤680px）缩为（22px）。设置标题使用 `title`，面板标题使用 `panel-title`。
- 正文使用 `body`；消息正文与页面说明使用（13px），工具栏、表格和按钮以（12px）为主。
- 字段标签使用 `label`，字段说明和状态标签使用 `meta`；变量名在标签旁使用等宽字（10px），≤1150px 时另起一行。

## Layout

固定侧栏默认宽（224px），工作区同步留出左侧位置。顶部栏高（71px）；内容居中，最大宽（1540px），默认内边距（32px 36px 88px）。概览采用（1.45fr / 1fr）双列，消息和日志使用完整工作区。设置使用（168px）分组导航和两列表单，字段间距（24px）；文本域与布尔设置横跨整行。

| 实际媒体条件 | 布局变化 |
| --- | --- |
| ≥1650px | 内容上边距增至38px，概览间距增至25px。 |
| ≤1150px | 侧栏和保存栏偏移改为195px；内容左右25px；设置导航145px。 |
| ≤900px | 概览与设置布局改为单列；设置分组成为可换行按钮；隐藏顶部搜索。 |
| ≤680px | 侧栏转为224px抽屉；顶部栏61px，内容左右17px；表单单列，搜索独占一行，保存栏铺满视口；流程纵向排列，筛选具有独立标签与 44px 高控件。 |
| ≤380px | 登录区单列，账号区允许换行，底部保存栏进一步收紧文字与操作间距。 |

设置保存栏固定在底部，内容预留底部空间。日志表格保留横向滚动；消息正文、字段键名和长地址允许换行，避免撑宽页面。

## Elevation & Depth

静态面板通过背景、细边框和分隔线建立层次，无静态卡片阴影。提示浮层使用轻阴影（`0 6px 24px #10281c26`）；确认对话框使用更深阴影（`0 14px 55px #112b2240`）。移动导航与对话框以半透明深绿遮罩覆盖工作区。阴影仅用于这些临时浮层。

## Shapes

形态以小圆角和细边框为主：面板使用 `rounded.panel`，控件使用 `rounded.control`，状态标签使用 `rounded.tag`，提示条与浮层使用 `rounded.feedback`。边框通常为（1px）；状态圆点保持圆形。图标使用内联 SVG 线条，通用图标（19px），按钮内图标（16px）。

## Components

- **按钮**：主操作为实心绿，次操作为白底细边框，危险操作使用红字，文字按钮用于轻量跳转。标准按钮最小高度（37px），小按钮为（30px）。主按钮悬停加深，次按钮悬停变灰绿；禁用按钮透明度（0.55）。当前实现不添加按钮位移或动画。
- **输入与设置**：白底、字段边框和完整标签，最小高度（39px）。悬停加深边框；被启动环境覆盖的字段显示禁用底色。密钥以密码输入和保留提示呈现，查看、生成、清空为独立文字操作。校验使用原生约束与错误提示，不能把未实现的红色字段边框写成惯例。
- **键盘焦点**：按钮、链接、输入、选择框和折叠摘要共用（3px）焦点轮廓，偏移（3px），颜色为 `focus`。焦点不依赖悬停。
- **导航**：深绿背景、SVG 与文字并排；当前页以浅绿实面和较重文字标记。移动抽屉沿水平轴移动（0.2s ease-out）；打开时聚焦当前页，Tab 保持在抽屉内，Esc、遮罩、关闭按钮和选择页面均可关闭，关闭后焦点回到菜单按钮。减少动态效果偏好会关闭过渡和动画。
- **消息与日志**：消息按元数据、正文、可展开原始事件排列；正文保留换行，过长内容内部滚动。日志使用时间、级别、事件和诊断字段表格。工具栏提供搜索、筛选、暂停、清空显示和导出；暂停只冻结显示，后台继续接收。空列表显示明确标题和说明。
- **保存反馈**：底栏区分未保存、已保存和待重启，保存或重启时禁用相关动作。一般反馈使用短暂提示；错误、模拟模式与待重启使用可见提示条。
- **消息到回复流程**：三步横向排列，顺序为接收消息 → AI 生成 → 发送回复。每步显示实际连接、开关或队列状态，点击分别进入消息监听、AI 设置与任务队列；悬停仅改变标题颜色。窄屏改为纵向步骤，每步图标、标题与状态组成完整行，不压缩状态文字。

**The 保存与生效 Rule.** 保存动作完成后仍明确展示待重启状态；重启生效是独立动作。

## Do's and Don'ts

### Do:

- **Do** 使用现有松绿、灰白和语义状态色，并配合状态文字。
- **Do** 延续中文系统字体、两列表单和可换行的紧凑元数据。
- **Do** 保留键盘焦点、长内容滚动、窄屏单列和移动导航的焦点管理。
- **Do** 将运行流程链接到对应操作页面，持续显示真实状态。

### Don't:

- **Don't** 用装饰阴影替代静态面板的细边框与色面层次。
- **Don't** 用颜色单独表达连接、暂停、失败或待核对。
- **Don't** 将保存成功写成配置已生效，或在暂停显示时暗示后台停止接收。
- **Don't** 在示例、导出说明或设计文档中填入真实密钥、消息正文或本机私密路径。

## 2026-10-25 review refinements

Phone flow is vertical at ≤680px. Type/direction filters have visible labels and 44px controls. Fields use #72877b boundaries; focus uses #267456 on light surfaces and #b8dbc8 on the rail. Recent activity follows its content. Message disclosure uses keyed rows. Retention copy separates transient page history from disk data, and task details distinguish content states. See docs/UI-REVIEW.md for measured evidence.
