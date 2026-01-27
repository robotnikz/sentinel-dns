import React from 'react';
import { X } from 'lucide-react';

export const modalCardBaseClass =
  'dashboard-card w-full rounded-lg overflow-hidden animate-fade-in shadow-2xl border border-[#27272a] bg-[#09090b]';

type ModalCardProps = {
  children: React.ReactNode;
  className?: string;
};

export const ModalCard: React.FC<ModalCardProps> = ({ children, className }) => {
  return <div className={`${modalCardBaseClass} ${className || ''}`}>{children}</div>;
};

type ModalHeaderProps = {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  titleRight?: React.ReactNode;

  icon?: React.ReactNode;
  iconContainerClassName?: string;
  subtitleClassName?: string;

  onClose?: () => void;
  closeDisabled?: boolean;
};

export const ModalHeader: React.FC<ModalHeaderProps> = ({
  title,
  subtitle,
  titleRight,
  icon,
  iconContainerClassName = 'bg-[#18181b] border-[#27272a]',
  subtitleClassName = 'text-zinc-400 text-xs mt-0.5',
  onClose,
  closeDisabled = false
}) => {
  return (
    <div className="p-5 border-b border-[#27272a] flex justify-between items-start bg-[#121214]">
      <div className="flex items-center gap-3">
        {icon ? (
          <div className={`p-2 rounded-lg border ${iconContainerClassName}`}>{icon}</div>
        ) : null}
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">{title}</h3>
            {titleRight ? titleRight : null}
          </div>
          {subtitle ? <p className={subtitleClassName}>{subtitle}</p> : null}
        </div>
      </div>

      {onClose ? (
        <button
          onClick={() => {
            if (closeDisabled) return;
            onClose();
          }}
          disabled={closeDisabled}
          className={
            closeDisabled
              ? 'text-zinc-700 cursor-not-allowed'
              : 'text-zinc-500 hover:text-white transition-colors'
          }
        >
          <X className="w-5 h-5" />
        </button>
      ) : null}
    </div>
  );
};

type ModalFooterProps = {
  children: React.ReactNode;
  className?: string;
};

export const ModalFooter: React.FC<ModalFooterProps> = ({ children, className }) => {
  return (
    <div className={`p-4 border-t border-[#27272a] bg-[#121214] flex justify-end gap-2 ${className || ''}`}>
      {children}
    </div>
  );
};
