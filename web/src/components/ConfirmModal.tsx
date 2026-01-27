import React from 'react';
import { AlertTriangle, ShieldCheck, Trash2 } from 'lucide-react';
import Modal from './Modal';
import { ModalCard, ModalFooter, ModalHeader } from './ModalLayout';

export type ConfirmVariant = 'default' | 'warning' | 'danger';

type ConfirmModalProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  body: React.ReactNode;

  confirmText: string;
  busyText?: string;
  variant?: ConfirmVariant;

  busy?: boolean;
  disableCloseWhileBusy?: boolean;

  message?: React.ReactNode;

  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

const ConfirmModal: React.FC<ConfirmModalProps> = ({
  open,
  title,
  subtitle,
  body,
  confirmText,
  busyText = 'WORKING…',
  variant = 'default',
  busy = false,
  disableCloseWhileBusy = true,
  message,
  onCancel,
  onConfirm
}) => {
  const canClose = !(disableCloseWhileBusy && busy);

  const icon =
    variant === 'danger' ? (
      <Trash2 className="w-5 h-5 text-rose-300" />
    ) : variant === 'warning' ? (
      <AlertTriangle className="w-5 h-5 text-amber-300" />
    ) : (
      <ShieldCheck className="w-5 h-5 text-emerald-300" />
    );

  const iconWrapClass =
    variant === 'danger'
      ? 'bg-rose-500/10 border-rose-500/20'
      : variant === 'warning'
        ? 'bg-amber-500/10 border-amber-500/20'
        : 'bg-emerald-500/10 border-emerald-500/20';

  const confirmBtnClass =
    busy
      ? variant === 'danger'
        ? 'bg-rose-950/30 text-rose-300/70 cursor-wait'
        : variant === 'warning'
          ? 'bg-amber-950/30 text-amber-300/70 cursor-wait'
          : 'bg-emerald-950/30 text-emerald-300/70 cursor-wait'
      : variant === 'danger'
        ? 'bg-rose-600 hover:bg-rose-500 text-white'
        : variant === 'warning'
          ? 'bg-amber-600 hover:bg-amber-500 text-white'
          : 'bg-emerald-600 hover:bg-emerald-500 text-white';

  const cancelBtnClass =
    `px-4 py-2 rounded border border-[#27272a] transition-all text-xs font-bold ` +
    (busy ? 'text-zinc-700 cursor-not-allowed' : 'text-zinc-300 hover:bg-[#27272a]');

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!canClose) return;
        onCancel();
      }}
      closeOnBackdrop={canClose}
      closeOnEscape={canClose}
      zIndex={1000}
    >
      <ModalCard className="max-w-md">
        <ModalHeader
          title={title}
          subtitle={subtitle}
          icon={icon}
          iconContainerClassName={iconWrapClass}
          onClose={() => {
            if (!canClose) return;
            onCancel();
          }}
          closeDisabled={!canClose}
        />

        <div className="p-6 space-y-3">
          <div className="p-3 rounded bg-[#18181b] border border-[#27272a]">
            <div className="text-xs text-zinc-200">{body}</div>
          </div>
          {message ? <div className="text-xs text-zinc-400 font-mono">{message}</div> : null}
        </div>

        <ModalFooter>
          <button
            onClick={() => {
              if (!canClose) return;
              onCancel();
            }}
            disabled={!canClose}
            className={cancelBtnClass}
          >
            CANCEL
          </button>
          <button
            onClick={() => void onConfirm()}
            disabled={busy}
            className={`px-4 py-2 rounded transition-all text-xs font-bold flex items-center gap-2 ${confirmBtnClass}`}
          >
            {variant === 'danger' ? (
              <Trash2 className="w-3.5 h-3.5" />
            ) : variant === 'warning' ? (
              <AlertTriangle className="w-3.5 h-3.5" />
            ) : (
              <ShieldCheck className="w-3.5 h-3.5" />
            )}
            {busy ? busyText : confirmText}
          </button>
        </ModalFooter>
      </ModalCard>
    </Modal>
  );
};

export default ConfirmModal;
