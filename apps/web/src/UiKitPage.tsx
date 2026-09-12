import { useState } from 'react';
import {
  ArrowLeft,
  Check,
  ClipboardList,
  LayoutList,
  LibraryBig,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  X,
} from 'lucide-react';

import {
  ActionProposalCard,
  AgentComposer,
  AgentWorkspaceShell,
  ArtifactCanvas,
  ArtifactDiffView,
  ArtifactReviewTimeline,
  ArtifactTraceList,
  ArtifactVersionRail,
  ArtifactWorkspaceShell,
  Badge,
  Button,
  ConfirmDialog,
  ContextGroup,
  ContextRail,
  DataTableFrame,
  DecisionFooter,
  DetailLayout,
  Drawer,
  EvidenceBar,
  GlobalHeader,
  InfoPanel,
  LifecycleRail,
  ModuleAccent,
  PageIntro,
  PrimaryNav,
  ReadinessPanel,
  RequirementContextHeader,
  SearchField,
  SegmentedControl,
  SelectField,
  ScopeDiff,
  SummaryGrid,
  SummaryPanel,
  SubNav,
  VersionDiffReview,
  WorkBlock,
  WorkMessage,
  WorkStream,
} from '@pfc/ui';

const viewOptions = [
  {
    icon: <LayoutList aria-hidden="true" size={15} strokeWidth={1.8} />,
    label: '表格',
    value: 'TABLE',
  },
  {
    icon: <ShieldCheck aria-hidden="true" size={15} strokeWidth={1.8} />,
    label: '按阶段',
    value: 'STAGE',
  },
] as const;

export function UiKitPage() {
  const [search, setSearch] = useState('需求');
  const [view, setView] = useState<'TABLE' | 'STAGE'>('TABLE');
  const [primary, setPrimary] = useState<
    'REQUIREMENTS' | 'GATES' | 'MATERIALS'
  >('REQUIREMENTS');
  const [scope, setScope] = useState<'ALL' | 'MINE' | 'BLOCKED'>('ALL');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [agentMessage, setAgentMessage] = useState('继续梳理费率例外场景');
  const [artifactVersion, setArtifactVersion] = useState('V2');

  return (
    <main className="pfc-reference-theme ui-kit">
      <GlobalHeader
        account={
          <span className="ui-kit__account">
            <span className="avatar">PM</span>
            <span>
              产品负责人<small>LOCAL</small>
            </span>
          </span>
        }
        actions={
          <a className="ui-kit__back" href="/">
            <ArrowLeft aria-hidden="true" size={16} strokeWidth={1.8} />
            返回工作台
          </a>
        }
        brand={
          <div className="ui-kit__brand">
            <span className="ui-kit__brand-mark" aria-hidden="true">
              <Settings2 size={20} strokeWidth={1.8} />
            </span>
            <span>
              <strong>产品全链路 UI</strong>
              <small>UI-R11 元素目录</small>
            </span>
          </div>
        }
        navigation={
          <PrimaryNav
            ariaLabel="设计系统主导航示例"
            onChange={setPrimary}
            options={[
              { label: '需求管理', value: 'REQUIREMENTS' },
              { label: '门禁中心', value: 'GATES' },
              { label: '材料库', value: 'MATERIALS' },
            ]}
            value={primary}
          />
        }
        className="pfc-reference-header"
        data-module="requirements"
      />

      <PageIntro
        actions={
          <Badge variant="success">
            <Check aria-hidden="true" size={13} strokeWidth={2} />
            UI-R11
          </Badge>
        }
        context="CAP-PFC-01 · 平台元素规范"
        description="导航、页面层级与业务控件由同一套模板约束，后续页面直接组合使用。"
        icon={<ClipboardList size={30} strokeWidth={1.8} />}
        module="requirements"
        title="统一元素，稳定交互"
      >
        <SubNav
          ariaLabel="需求视图示例"
          onChange={setScope}
          options={[
            { label: '全部需求', value: 'ALL' },
            { label: '待我处理', value: 'MINE' },
            { label: '阻断项', value: 'BLOCKED' },
          ]}
          value={scope}
        />
      </PageIntro>

      <div className="ui-kit__content">
        <section className="ui-kit__module-row" aria-label="模块识别色">
          <ModuleAccent
            icon={<ClipboardList size={16} strokeWidth={1.8} />}
            label="需求模块"
            module="requirements"
          />
          <ModuleAccent
            icon={<ShieldCheck size={16} strokeWidth={1.8} />}
            label="门禁模块"
            module="gates"
          />
          <ModuleAccent
            icon={<LibraryBig size={16} strokeWidth={1.8} />}
            label="材料模块"
            module="materials"
          />
        </section>

        <section className="ui-kit__section" aria-labelledby="ui-color-title">
          <header>
            <h2 id="ui-color-title">颜色与表面</h2>
            <p>品牌色只强调动作和当前位置，业务状态使用独立语义色。</p>
          </header>
          <div className="ui-kit__swatches">
            <div className="ui-swatch ui-swatch--primary">
              <span />
              <strong>主操作</strong>
            </div>
            <div className="ui-swatch ui-swatch--accent">
              <span />
              <strong>品牌强调</strong>
            </div>
            <div className="ui-swatch ui-swatch--success">
              <span />
              <strong>通过</strong>
            </div>
            <div className="ui-swatch ui-swatch--warning">
              <span />
              <strong>需关注</strong>
            </div>
            <div className="ui-swatch ui-swatch--danger">
              <span />
              <strong>阻断</strong>
            </div>
          </div>
        </section>

        <section className="ui-kit__section" aria-labelledby="ui-type-title">
          <header>
            <h2 id="ui-type-title">排版</h2>
            <p>参考站中文字体栈，页面标题 30px，数字保持等宽。</p>
          </header>
          <div className="ui-kit__type-scale">
            <div className="ui-type-page">页面标题 30 / 36</div>
            <div className="ui-type-section">区块标题 18 / 26</div>
            <div className="ui-type-body">正文信息 16 / 24</div>
            <div className="ui-type-label">控件标签 14 / 20</div>
            <div className="ui-type-caption">辅助说明 12 / 18</div>
          </div>
        </section>

        <section className="ui-kit__section" aria-labelledby="ui-action-title">
          <header>
            <h2 id="ui-action-title">操作与状态</h2>
            <p>同一操作在默认、悬停、按下、焦点、禁用和加载状态保持一致。</p>
          </header>
          <div className="ui-kit__examples">
            <Button icon={<Plus aria-hidden="true" size={16} />}>
              新建需求
            </Button>
            <Button variant="secondary">次要操作</Button>
            <Button variant="ghost">文字操作</Button>
            <Button disabled>不可操作</Button>
            <Button loading>处理中</Button>
          </div>
          <div className="ui-kit__examples">
            <Badge variant="info">进行中</Badge>
            <Badge variant="success">已通过</Badge>
            <Badge variant="warning">需关注</Badge>
            <Badge variant="danger">阻断</Badge>
            <Badge>未开始</Badge>
          </div>
        </section>

        <section className="ui-kit__section" aria-labelledby="ui-filter-title">
          <header>
            <h2 id="ui-filter-title">筛选与输入</h2>
            <p>搜索、分段选择和下拉筛选共享高度、焦点与错误反馈。</p>
          </header>
          <div className="ui-kit__filters">
            <SearchField
              ariaLabel="组件搜索"
              clearIcon={<X aria-hidden="true" size={15} />}
              onChange={setSearch}
              placeholder="搜索组件"
              searchIcon={<Search aria-hidden="true" size={17} />}
              value={search}
            />
            <SegmentedControl
              ariaLabel="示例视图"
              onChange={setView}
              options={viewOptions}
              value={view}
            />
            <SelectField label="门禁阶段" value="G0" onChange={() => undefined}>
              <option value="G0">G0</option>
              <option value="G1">G1</option>
            </SelectField>
          </div>
        </section>

        <section className="ui-kit__section" aria-labelledby="ui-data-title">
          <header>
            <h2 id="ui-data-title">摘要与数据表格</h2>
            <p>摘要和表格承载高密度业务信息，状态、数字和动作保持固定对齐。</p>
          </header>
          <div className="ui-kit__data-patterns">
            <SummaryGrid aria-label="设计系统摘要示例">
              <SummaryPanel
                items={[
                  { label: '最早阶段', value: 'G0' },
                  { label: '最前阶段', value: 'G6' },
                  { label: '覆盖阶段', value: 2 },
                ]}
                meta="2 个阶段"
                title="阶段推进"
              />
              <SummaryPanel
                items={[
                  { label: '阻断', value: 1 },
                  { label: '需关注', value: 0 },
                  { label: '未开始', value: 2 },
                ]}
                meta="1 项需处理"
                title="门禁态势"
              />
            </SummaryGrid>
            <DataTableFrame className="table-wrap ui-kit__table">
              <table aria-label="设计系统表格示例">
                <thead>
                  <tr>
                    <th>需求名称</th>
                    <th>当前阶段</th>
                    <th>门禁状态</th>
                    <th>责任人</th>
                    <th>下一步</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>渠道结算规则统一</td>
                    <td>G3</td>
                    <td>
                      <Badge variant="warning">需关注</Badge>
                    </td>
                    <td>产品负责人</td>
                    <td>
                      <Button size="sm" variant="ghost">
                        处理门禁
                      </Button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </DataTableFrame>
            <DetailLayout
              aria-label="详情页布局示例"
              aside={
                <InfoPanel title="运行上下文">
                  <p>固定 Skill、工作区与 Git 基线使用键值信息呈现。</p>
                </InfoPanel>
              }
              primary={
                <InfoPanel title="事件时间线">
                  <p>事件按单调序号展示，断线后从已确认位置继续。</p>
                </InfoPanel>
              }
            />
          </div>
        </section>

        <section className="ui-kit__section" aria-labelledby="ui-agent-title">
          <header>
            <h2 id="ui-agent-title">AI 协作工作台</h2>
            <p>
              Agent
              作业、结构化成果、生命周期和证据状态使用固定模板，不由业务页面自行拼装。
            </p>
          </header>
          <AgentWorkspaceShell
            aria-label="AI 工作台模板"
            artifact={
              <ArtifactCanvas
                actions={<Badge variant="warning">草稿</Badge>}
                description="结构化对象与字段级变更"
                title="成果画布"
              >
                <div className="pfc-artifact-canvas__body">
                  <ActionProposalCard
                    actions={
                      <>
                        <Button size="sm" variant="secondary">
                          拒绝
                        </Button>
                        <Button size="sm">确认并应用</Button>
                      </>
                    }
                    meta="QUESTION · 目标版本 2 · PRODUCT_MANAGER"
                    title="回答需求问题"
                  >
                    <VersionDiffReview
                      ariaLabel="AI 工作台提案示例"
                      rows={[
                        {
                          field: '结算口径',
                          before: '未填写',
                          after: '以审批通过的费率版本为准',
                        },
                      ]}
                    />
                  </ActionProposalCard>
                </div>
              </ArtifactCanvas>
            }
            context={
              <ContextRail description="2 项已授权上下文" title="工作上下文">
                <div className="pfc-context-rail__body">
                  <ContextGroup
                    items={[
                      {
                        label: '渠道费率说明',
                        meta: 'MATERIAL_REF · v2',
                        status: <Badge variant="success">INTERNAL</Badge>,
                      },
                    ]}
                    title="来源材料"
                  />
                  <ContextGroup
                    items={[
                      {
                        label: '费率生效口径',
                        meta: '等待产品负责人确认',
                        status: <Badge variant="warning">待确认</Badge>,
                      },
                    ]}
                    title="待确认问题"
                  />
                </div>
              </ContextRail>
            }
            contextHeader={
              <RequirementContextHeader
                context="产品 Agent 协作 · REQ-PFC-DEMO"
                meta={[
                  { label: '当前阶段', value: '阶段 G3' },
                  { label: '权威版本', value: '版本 4' },
                  { label: 'Owner', value: 'Owner · 产品负责人' },
                  { label: '风险', tone: 'warning', value: '1 项待确认' },
                ]}
                title="渠道费率规则统一"
              />
            }
            evidence={
              <EvidenceBar
                ariaLabel="AI 工作台证据示例"
                items={[
                  { available: true, label: 'Skill', value: '固定版本' },
                  { available: true, label: 'Codex', value: '已连接' },
                  { available: true, label: 'Bridge', value: '已连接' },
                  { available: true, label: 'MCP', value: '可用 · 1' },
                  { available: false, label: 'Zed', value: '未接入' },
                ]}
              />
            }
            lifecycle={
              <LifecycleRail
                ariaLabel="AI 工作台生命周期示例"
                items={[
                  { label: '登记', state: 'complete', value: 'G0' },
                  { label: '澄清', state: 'complete', value: 'G1' },
                  { label: '范围', state: 'complete', value: 'G2' },
                  { label: '方案', state: 'current', value: 'G3' },
                  { label: '技术', state: 'upcoming', value: 'G4' },
                ]}
              />
            }
            preview
            stream={
              <WorkStream
                composer={
                  <AgentComposer
                    label="给产品 Agent 的任务"
                    onSubmit={() => undefined}
                    scope="2 项上下文 · 固定 Skill"
                    textareaProps={{
                      onChange: (event) => setAgentMessage(event.target.value),
                      rows: 2,
                    }}
                    value={agentMessage}
                  />
                }
                description="服务端事件已连接"
                title="Agent 作业流"
              >
                <ReadinessPanel
                  description="发送前核对材料、Skill 与授权状态。"
                  ready
                  summary="1 项上下文"
                  title="本回合作业范围"
                >
                  <div className="pfc-readiness-panel__group">
                    <strong>上下文</strong>
                    <span>渠道费率说明 v2 · INTERNAL</span>
                  </div>
                  <div className="pfc-readiness-panel__group">
                    <strong>执行能力</strong>
                    <span>产品需求分析 · 2026.09.07-r1</span>
                  </div>
                </ReadinessPanel>
                <WorkMessage actor="user" label="产品经理" meta="回合 1">
                  <p>核对渠道费率的生效口径。</p>
                </WorkMessage>
                <WorkMessage
                  actor="agent"
                  label="产品 Agent"
                  meta={<Badge variant="success">回合已完成</Badge>}
                >
                  <p>已形成一项待确认回答，请在右侧核对变更。</p>
                </WorkMessage>
                <WorkBlock
                  actions={<Badge variant="success">已归档</Badge>}
                  eyebrow="MCP 只读能力"
                  title="requirement-context-read"
                >
                  <p>已读取 3 项需求上下文。</p>
                  <small>耗时 420 ms · 96 bytes</small>
                </WorkBlock>
              </WorkStream>
            }
          />
        </section>

        <section
          className="ui-kit__section"
          aria-labelledby="ui-artifact-collaboration-title"
        >
          <header>
            <h2 id="ui-artifact-collaboration-title">制品协作模板</h2>
            <p>版本、正文差异、评审与追溯共用固定三栏结构和状态语言。</p>
          </header>
          <ArtifactWorkspaceShell
            ariaLabel="制品协作模板示例"
            versions={
              <ArtifactVersionRail
                currentVersionId="V2"
                onSelect={setArtifactVersion}
                selectedVersionId={artifactVersion}
                versions={[
                  {
                    id: 'V2',
                    label: 'V0.2',
                    meta: '陈立',
                    createdAt: '09/09 10:00',
                  },
                  {
                    id: 'V1',
                    label: 'V0.1',
                    meta: '陈立',
                    createdAt: '09/09 09:00',
                  },
                ]}
              />
            }
            canvas={
              <ArtifactDiffView
                changes={[
                  { kind: 'UNCHANGED', lines: ['## 结算口径'] },
                  { kind: 'REMOVED', lines: ['待业务确认。'] },
                  { kind: 'ADDED', lines: ['以审批通过的费率版本为准。'] },
                ]}
                fromLabel="V0.1"
                toLabel="V0.2"
              />
            }
            context={
              <div className="ui-kit__data-patterns">
                <ArtifactReviewTimeline
                  items={[
                    {
                      id: 'REVIEW-DEMO',
                      conclusion: 'APPROVED',
                      responsibility: 'PRODUCT',
                      comment: '产品口径已确认。',
                      reviewer: '陈立',
                      createdAt: '09/09 10:30',
                    },
                  ]}
                />
                <ArtifactTraceList
                  items={[
                    {
                      id: 'TRACE-DEMO',
                      direction: 'INCOMING',
                      relation: 'EVIDENCED_BY',
                      subject: '来源材料',
                      locator: 'docs/source.md#L12',
                      validity: 'VALID',
                    },
                  ]}
                />
              </div>
            }
          />
        </section>

        <section
          className="ui-kit__section"
          aria-labelledby="ui-decision-title"
        >
          <header>
            <h2 id="ui-decision-title">审批与危险操作</h2>
            <p>
              范围核对使用右侧抽屉；取消、撤销和重试使用有焦点回归的确认框。
            </p>
          </header>
          <div className="ui-kit__examples">
            <Button onClick={() => setDrawerOpen(true)} variant="secondary">
              查看审批抽屉
            </Button>
            <Button onClick={() => setConfirmOpen(true)} variant="danger">
              打开确认框
            </Button>
          </div>
          {drawerOpen ? (
            <Drawer
              aria-label="文件变更审批示例"
              closeIcon={<X aria-hidden="true" size={18} strokeWidth={1.8} />}
              description="仅展示相对位置和影响上限"
              onClose={() => setDrawerOpen(false)}
              title="文件变更审批"
            >
              <ScopeDiff
                requested={{
                  label: '请求范围',
                  paths: ['docs/requirements/acceptance.md'],
                  actions: ['EDIT_FILES', 'FORMAT'],
                  maxChangedFiles: 1,
                  maxChangedBytes: 4096,
                  networkAccess: false,
                }}
              />
              <DecisionFooter guidance="批准只对本次请求生效。">
                <Button variant="secondary">拒绝</Button>
                <Button>批准一次</Button>
              </DecisionFooter>
            </Drawer>
          ) : null}
          {confirmOpen ? (
            <ConfirmDialog
              actions={
                <>
                  <Button
                    onClick={() => setConfirmOpen(false)}
                    variant="secondary"
                  >
                    返回
                  </Button>
                  <Button
                    onClick={() => setConfirmOpen(false)}
                    variant="danger"
                  >
                    确认执行
                  </Button>
                </>
              }
              onDismiss={() => setConfirmOpen(false)}
              title="确认取消运行"
            >
              <p>状态变化时会拒绝执行，操作结果进入审计记录。</p>
            </ConfirmDialog>
          ) : null}
        </section>
      </div>
    </main>
  );
}
