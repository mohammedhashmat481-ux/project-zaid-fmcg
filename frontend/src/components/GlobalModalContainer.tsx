import React, { useEffect, useCallback, useState } from 'react';
import * as Icons from 'lucide-react';
import { useToastStore } from '../store/toastStore';

export const GlobalModalContainer: React.FC = () => {
  const {
    confirm,
    alertModal,
    toasts,
    hideConfirm,
    hideAlertModal,
    hideToast
  } = useToastStore();

  const [confirmLoading, setConfirmLoading] = useState(false);

  // Handle ESC key to dismiss dialogs
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (alertModal) {
          alertModal.onClose?.();
          hideAlertModal();
        } else if (confirm && !confirmLoading) {
          confirm.onCancel?.();
          hideConfirm();
        }
      }
    },
    [alertModal, confirm, confirmLoading, hideAlertModal, hideConfirm]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleConfirmAction = async () => {
    if (!confirm) return;
    try {
      setConfirmLoading(true);
      await Promise.resolve(confirm.onConfirm());
      hideConfirm();
    } catch (err) {
      console.error('Error during confirm action:', err);
    } finally {
      setConfirmLoading(false);
    }
  };

  const handleCancelAction = () => {
    if (!confirm || confirmLoading) return;
    confirm.onCancel?.();
    hideConfirm();
  };

  const handleAlertClose = () => {
    if (!alertModal) return;
    alertModal.onClose?.();
    hideAlertModal();
  };

  return (
    <>
      {/* 1. CONFIRMATION MODAL POPUP */}
      {confirm && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 overflow-y-auto"
        >
          {/* Backdrop Blur */}
          <div
            onClick={handleCancelAction}
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm transition-opacity animate-modal-fade-in"
          />

          {/* Modal Container */}
          <div className="relative w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl shadow-[0_24px_64px_-12px_rgba(15,23,42,0.32)] overflow-hidden z-10 animate-modal-scale-up">
            {/* Top Accent Stripe */}
            <div
              className={`h-1.5 w-full ${
                confirm.type === 'danger'
                  ? 'bg-gradient-to-r from-rose-500 via-red-500 to-rose-600'
                  : confirm.type === 'warning'
                  ? 'bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600'
                  : confirm.type === 'success'
                  ? 'bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600'
                  : 'bg-gradient-to-r from-indigo-500 via-blue-500 to-indigo-600'
              }`}
            />

            {/* Modal Content */}
            <div className="p-6 sm:p-7">
              {/* Header with Icon Badge and Close Button */}
              <div className="flex items-start justify-between gap-4 mb-4">
                <div
                  className={`w-13 h-13 rounded-2xl flex items-center justify-center ring-1 ring-inset shadow-xs ${
                    confirm.type === 'danger'
                      ? 'bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 ring-rose-500/20'
                      : confirm.type === 'warning'
                      ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 ring-amber-500/20'
                      : confirm.type === 'success'
                      ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 ring-emerald-500/20'
                      : 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 ring-indigo-500/20'
                  }`}
                >
                  {confirm.type === 'danger' ? (
                    <Icons.Trash2 className="w-6 h-6 stroke-[2.2]" />
                  ) : confirm.type === 'warning' ? (
                    <Icons.AlertTriangle className="w-6 h-6 stroke-[2.2]" />
                  ) : confirm.type === 'success' ? (
                    <Icons.CheckCircle2 className="w-6 h-6 stroke-[2.2]" />
                  ) : (
                    <Icons.HelpCircle className="w-6 h-6 stroke-[2.2]" />
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleCancelAction}
                  disabled={confirmLoading}
                  className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <Icons.X className="w-4 h-4" />
                </button>
              </div>

              {/* Title & Description */}
              <h3 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tracking-tight leading-snug">
                {confirm.title}
              </h3>
              <p className="mt-2 text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed font-normal">
                {confirm.message}
              </p>

              {/* Actions Footer */}
              <div className="mt-6 sm:mt-7 flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800/80">
                <button
                  type="button"
                  onClick={handleCancelAction}
                  disabled={confirmLoading}
                  className="px-5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 text-xs font-bold uppercase tracking-wider transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50"
                >
                  {confirm.cancelText || 'Cancel'}
                </button>
                <button
                  type="button"
                  onClick={handleConfirmAction}
                  disabled={confirmLoading}
                  className={`px-6 py-2.5 rounded-xl text-white text-xs font-bold uppercase tracking-wider shadow-md transition-all active:scale-[0.98] flex items-center gap-2 cursor-pointer disabled:opacity-60 ${
                    confirm.type === 'danger'
                      ? 'bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 shadow-rose-600/20'
                      : confirm.type === 'warning'
                      ? 'bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 shadow-amber-600/20'
                      : 'bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 shadow-indigo-600/20'
                  }`}
                >
                  {confirmLoading && (
                    <Icons.Loader2 className="w-3.5 h-3.5 animate-spin" />
                  )}
                  {confirm.confirmText || (confirm.type === 'danger' ? 'Confirm Delete' : 'Confirm')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. ALERT / SUCCESS / ERROR MODAL POPUP */}
      {alertModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 overflow-y-auto"
        >
          {/* Backdrop Blur */}
          <div
            onClick={handleAlertClose}
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm transition-opacity animate-modal-fade-in"
          />

          {/* Modal Container */}
          <div className="relative w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl shadow-[0_24px_64px_-12px_rgba(15,23,42,0.32)] overflow-hidden z-10 text-center animate-modal-scale-up">
            {/* Top Accent Stripe */}
            <div
              className={`h-1.5 w-full ${
                alertModal.type === 'success'
                  ? 'bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600'
                  : alertModal.type === 'error'
                  ? 'bg-gradient-to-r from-rose-500 via-red-500 to-rose-600'
                  : alertModal.type === 'warning'
                  ? 'bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600'
                  : 'bg-gradient-to-r from-indigo-500 via-blue-500 to-indigo-600'
              }`}
            />

            {/* Modal Content */}
            <div className="p-6 sm:p-8 flex flex-col items-center">
              {/* Close Button top-right */}
              <div className="absolute top-4 right-4">
                <button
                  type="button"
                  onClick={handleAlertClose}
                  className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <Icons.X className="w-4 h-4" />
                </button>
              </div>

              {/* Central Premium Badge Icon */}
              <div
                className={`w-16 h-16 rounded-2xl flex items-center justify-center ring-1 ring-inset shadow-xs mb-4 ${
                  alertModal.type === 'success'
                    ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 ring-emerald-500/25'
                    : alertModal.type === 'error'
                    ? 'bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 ring-rose-500/25'
                    : alertModal.type === 'warning'
                    ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 ring-amber-500/25'
                    : 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 ring-indigo-500/25'
                }`}
              >
                {alertModal.type === 'success' ? (
                  <Icons.CheckCircle2 className="w-8 h-8 stroke-[2.3]" />
                ) : alertModal.type === 'error' ? (
                  <Icons.XCircle className="w-8 h-8 stroke-[2.3]" />
                ) : alertModal.type === 'warning' ? (
                  <Icons.AlertTriangle className="w-8 h-8 stroke-[2.3]" />
                ) : (
                  <Icons.Info className="w-8 h-8 stroke-[2.3]" />
                )}
              </div>

              {/* Title & Message */}
              <h3 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tracking-tight">
                {alertModal.title}
              </h3>
              <p className="mt-2.5 text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed font-normal max-w-sm">
                {alertModal.message}
              </p>

              {/* Action Button */}
              <div className="mt-7 w-full flex justify-center">
                <button
                  type="button"
                  autoFocus
                  onClick={handleAlertClose}
                  className={`w-full sm:w-auto min-w-[140px] px-8 py-2.5 rounded-xl text-white text-xs font-bold uppercase tracking-wider shadow-lg active:scale-[0.98] transition-all cursor-pointer ${
                    alertModal.type === 'success'
                      ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-emerald-600/25'
                      : alertModal.type === 'error'
                      ? 'bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 shadow-rose-600/25'
                      : alertModal.type === 'warning'
                      ? 'bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 shadow-amber-600/25'
                      : 'bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 shadow-indigo-600/25'
                  }`}
                >
                  {alertModal.buttonText || (alertModal.type === 'success' ? 'Got It' : alertModal.type === 'error' ? 'Close' : 'Continue')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. SLEEK FLOATING TOAST STACK (Bottom Right) */}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          className="fixed bottom-5 right-5 z-[10000] flex flex-col gap-2.5 max-w-sm w-full pointer-events-none px-4 sm:px-0"
        >
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className="pointer-events-auto flex items-start gap-3 p-3.5 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-[0_12px_32px_-4px_rgba(15,23,42,0.18)] transition-all animate-toast-slide-up"
            >
              <div
                className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                  toast.type === 'success'
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : toast.type === 'error'
                    ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                    : toast.type === 'warning'
                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                    : 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                }`}
              >
                {toast.type === 'success' ? (
                  <Icons.CheckCircle2 className="w-4 h-4 stroke-[2.4]" />
                ) : toast.type === 'error' ? (
                  <Icons.XCircle className="w-4 h-4 stroke-[2.4]" />
                ) : toast.type === 'warning' ? (
                  <Icons.AlertTriangle className="w-4 h-4 stroke-[2.4]" />
                ) : (
                  <Icons.Info className="w-4 h-4 stroke-[2.4]" />
                )}
              </div>

              <div className="flex-1 text-xs text-slate-800 dark:text-slate-100 font-semibold leading-relaxed pt-0.5">
                {toast.message}
              </div>

              <button
                type="button"
                onClick={() => hideToast(toast.id)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
              >
                <Icons.X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
};

export default GlobalModalContainer;
