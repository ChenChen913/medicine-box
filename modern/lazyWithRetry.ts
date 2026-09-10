import React from 'react';

/**
 * React.lazy 的"带重试"版本。
 *
 * 弱网/缓存异常时动态 import 会失败；默认的 lazy 失败即抛错并卸载组件树（白屏）。
 * 这里在失败后自动重试若干次（常见的瞬时网络抖动可直接恢复），
 * 仍失败则抛给上层 ErrorBoundary 显示可读提示。
 */
// 与 React.lazy 的签名保持一致：组件的 props 类型各不相同，这里必须放开泛型约束
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRetry<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  retries = 2,
  delayMs = 500
): React.LazyExoticComponent<T> {
  return React.lazy(() => new Promise<{ default: T }>((resolve, reject) => {
    const attempt = (left: number): void => {
      factory()
        .then(resolve)
        .catch((err: unknown) => {
          if (left <= 0) {
            reject(err instanceof Error ? err : new Error(String(err)));
            return;
          }
          console.warn('[lazyWithRetry] 分块加载失败，正在重试（剩余 ' + left + ' 次）');
          setTimeout(() => attempt(left - 1), delayMs);
        });
    };
    attempt(retries);
  }));
}
