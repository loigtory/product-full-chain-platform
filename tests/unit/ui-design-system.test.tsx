// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  Button,
  DataTableFrame,
  DetailLayout,
  EmptyState,
  FilterToolbar,
  GlobalHeader,
  OverviewStrip,
  InfoPanel,
  PageIntro,
  PrimaryNav,
  SearchField,
  SegmentedControl,
  SummaryGrid,
  SummaryPanel,
  SubNav,
  Surface,
} from '../../packages/ui/src/index.ts';
import { UiKitPage } from '../../apps/web/src/UiKitPage.tsx';

afterEach(cleanup);

describe('platform UI design system', () => {
  it('exposes a loading button without losing its accessible name', () => {
    render(<Button loading>保存需求</Button>);

    const button = screen.getByRole('button', { name: '保存需求' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.className).toContain('pfc-button--primary');
  });

  it('uses pressed semantics for reusable segmented controls', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        ariaLabel="展示方式"
        onChange={onChange}
        options={[
          { label: '表格', value: 'TABLE' },
          { label: '按阶段', value: 'STAGE' },
        ]}
        value="TABLE"
      />,
    );

    expect(
      screen.getByRole('button', { name: '表格' }).getAttribute('aria-pressed'),
    ).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '按阶段' }));
    expect(onChange).toHaveBeenCalledWith('STAGE');
  });

  it('provides a discoverable clear action for search fields', () => {
    const onChange = vi.fn();
    render(
      <SearchField
        ariaLabel="搜索需求"
        onChange={onChange}
        placeholder="搜索需求名称"
        value="渠道"
      />,
    );

    const clearButton = screen.getByRole('button', { name: '清除搜索需求' });
    expect(clearButton.closest('label')).toBeNull();
    fireEvent.click(clearButton);
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('keeps surface variants explicit instead of page-local styling', () => {
    render(<Surface variant="outlined">门禁概览</Surface>);

    expect(screen.getByText('门禁概览').className).toContain(
      'pfc-surface--outlined',
    );
  });

  it('publishes an interactive element catalog for future page work', () => {
    render(<UiKitPage />);

    expect(
      screen.getByRole('heading', { name: '统一元素，稳定交互' }),
    ).toBeTruthy();
    expect(screen.getByLabelText('设计系统摘要示例')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '按阶段' }));
    expect(
      screen
        .getByRole('button', { name: '按阶段' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.getByRole('heading', { name: 'AI 协作工作台' })).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: '本回合作业范围' }),
    ).toBeTruthy();
    expect(screen.getByLabelText('AI 工作台模板')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '制品协作模板' })).toBeTruthy();
    expect(screen.getByLabelText('制品协作模板示例')).toBeTruthy();
  });

  it('publishes reusable operational page patterns', () => {
    render(
      <>
        <OverviewStrip
          ariaLabel="门禁概览"
          items={[{ label: '需处理', value: 3 }]}
          meta="更新于 14:00"
        />
        <SummaryGrid aria-label="推进摘要">
          <SummaryPanel
            items={[
              { label: '最早阶段', value: 'G0' },
              { label: '最前阶段', value: 'G6' },
              { label: '覆盖阶段', value: 2 },
            ]}
            meta="2 个阶段"
            title="阶段推进"
          />
        </SummaryGrid>
        <FilterToolbar aria-label="门禁筛选">筛选器</FilterToolbar>
        <DataTableFrame>
          <table aria-label="门禁数据" />
        </DataTableFrame>
        <EmptyState description="调整筛选条件" title="没有匹配记录" />
      </>,
    );

    expect(screen.getByLabelText('门禁概览').textContent).toContain('3需处理');
    expect(screen.getByLabelText('推进摘要').textContent).toContain(
      '阶段推进2 个阶段G0最早阶段G6最前阶段2覆盖阶段',
    );
    expect(screen.getByLabelText('门禁筛选')).toBeTruthy();
    expect(screen.getByLabelText('门禁数据')).toBeTruthy();
    expect(screen.getByText('没有匹配记录')).toBeTruthy();
  });

  it('publishes the shared operational detail layout', () => {
    render(
      <DetailLayout
        aside={
          <InfoPanel title="运行上下文">
            <span>只读工作区</span>
          </InfoPanel>
        }
        primary={
          <InfoPanel title="事件时间线">
            <span>运行已创建</span>
          </InfoPanel>
        }
      />,
    );

    expect(screen.getByRole('heading', { name: '事件时间线' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '运行上下文' })).toBeTruthy();
    expect(document.querySelector('.pfc-detail-layout__primary')).toBeTruthy();
    expect(document.querySelector('.pfc-detail-layout__aside')).toBeTruthy();
  });

  it('publishes the approved global navigation and module page shell', () => {
    const onPrimaryChange = vi.fn();
    const onSubChange = vi.fn();

    render(
      <>
        <GlobalHeader
          account={<span>产品负责人</span>}
          brand={<strong>产品全链路</strong>}
          density="compact"
          navigation={
            <PrimaryNav
              ariaLabel="平台主导航"
              onChange={onPrimaryChange}
              options={[
                { label: '需求', value: 'REQUIREMENTS' },
                { label: '门禁', value: 'GATES' },
                { label: '材料', value: 'MATERIALS' },
              ]}
              value="REQUIREMENTS"
            />
          }
        />
        <PageIntro
          context="CAP-PFC-01 · 本地工作区"
          density="compact"
          description="集中处理需求登记、评估与流转。"
          icon={<span data-testid="page-intro-icon">需求</span>}
          module="requirements"
          title="需求工作台"
        >
          <SubNav
            ariaLabel="需求视图"
            onChange={onSubChange}
            options={[
              { label: '全部需求', value: 'ALL' },
              { label: '待我处理', value: 'MINE' },
              { label: '阻断项', value: 'BLOCKED' },
            ]}
            value="ALL"
          />
        </PageIntro>
      </>,
    );

    expect(
      screen.getByRole('button', { name: '需求' }).getAttribute('aria-current'),
    ).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: '门禁' }));
    expect(onPrimaryChange).toHaveBeenCalledWith('GATES');
    expect(
      screen
        .getByRole('button', { name: '全部需求' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '阻断项' }));
    expect(onSubChange).toHaveBeenCalledWith('BLOCKED');
    expect(screen.getByRole('heading', { name: '需求工作台' })).toBeTruthy();
    expect(
      document
        .querySelector('.pfc-page-intro__icon')
        ?.contains(screen.getByTestId('page-intro-icon')),
    ).toBe(true);
    expect(
      document
        .querySelector('.pfc-global-header')
        ?.getAttribute('data-density'),
    ).toBe('compact');
    expect(
      document.querySelector('.pfc-page-intro')?.getAttribute('data-density'),
    ).toBe('compact');
  });
});
