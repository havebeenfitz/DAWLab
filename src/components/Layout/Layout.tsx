import React from 'react';
import { motion } from 'motion/react';
import { useLocation } from 'react-router-dom';
import './Layout.css';
import { ActivityPanel } from '../ActivityPanel';
import { PreviewNotification } from '../PreviewNotification';
import { Toaster } from '../ui/Toaster';
import { DawGuardHost } from '../DawGuard/DawGuardHost';
import { ConfirmHost } from '../DawGuard/ConfirmHost';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const location = useLocation();
  const isLibraryPage = location.pathname === '/';

  return (
    <div className="app-layout">
      <motion.div
        className="main-content-wrapper"
        initial={false}
        animate={{
          marginLeft: 0,
          width: '100%',
        }}
        transition={{ duration: 0.3, ease: 'easeInOut' }}
      >
        {/* Draggable strip for the frameless titlebar (macOS traffic lights) */}
        <div className="top-header-bar" />
        <main className="app-main">
          {children}
        </main>
      </motion.div>
      {!isLibraryPage && <ActivityPanel />}
      <PreviewNotification />
      <Toaster />
      <DawGuardHost />
      <ConfirmHost />
    </div>
  );
};
