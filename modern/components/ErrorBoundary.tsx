import React from 'react';

interface Props {
  children: React.ReactNode;
  /** 出错时的兜底 UI（不传则用内置样式） */
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
}
interface State { error: Error | null; }

/**
 * 错误边界：把"整个页面白屏"变成"一块看得懂的提示 + 重试"。
 *
 * 为什么必须有：界面里存在按需加载的分块（经典版/抽屉/备份弹窗/Tab 视图）。
 * 弱网或缓存异常时，动态 import 失败会向上抛错；React 在没有错误边界的情况下
 * 会卸载整棵组件树 —— 用户看到的就是一片空白，完全不知道发生了什么。
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary] 界面渲染出错：', error, info.componentStack);
  }

  private reset = (): void => this.setState({ error: null });

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="max-w-sm w-full rounded-2xl bg-m3-surface-container-lowest shadow-lg p-6 text-center">
          <div className="text-base font-bold text-m3-on-surface mb-2">界面加载出错了</div>
          <p className="text-sm text-m3-on-surface-variant leading-relaxed mb-4">
            数据没有丢失，通常刷新一下就好。<br />如果反复出现，请把这一步告诉我。
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={this.reset}
              className="flex-1 py-2.5 rounded-xl bg-m3-primary text-m3-on-primary text-sm font-semibold"
            >
              重试
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="flex-1 py-2.5 rounded-xl border border-m3-outline-variant text-m3-on-surface text-sm font-semibold"
            >
              刷新页面
            </button>
          </div>
        </div>
      </div>
    );
  }
}
