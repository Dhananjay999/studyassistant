import React from 'react';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface NewSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedMode: 'pdf' | 'web';
  onConfirm: () => void;
  onCancel: () => void;
}

const NewSessionDialog: React.FC<NewSessionDialogProps> = ({
  open,
  onOpenChange,
  selectedMode,
  onConfirm,
  onCancel,
}) => {
  const isMobile = useIsMobile();

  const mobileContent = (
    <div className="text-center">
      <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-gradient-to-r from-academic-burgundy to-academic-rose flex items-center justify-center">
        <RefreshCw className="w-6 h-6 text-white" />
      </div>
      <h2 className="text-lg font-bold bg-gradient-to-r from-academic-burgundy to-academic-rose bg-clip-text text-transparent mb-2 text-center">
        Start New Session
      </h2>
      <p className="text-sm text-muted-foreground leading-relaxed mb-6 text-center">
        This will clear all {selectedMode === 'pdf' ? 'PDF files and chat history' : 'web search conversations'} from your current session.
        <br />
        <span className="text-academic-burgundy font-medium">This action cannot be undone.</span>
      </p>
      <div className="flex gap-3 w-full">
        <button
          onClick={onCancel}
          className="flex-1 px-3 py-3 border-2 border-academic-teal/30 text-academic-teal hover:bg-academic-teal/10 hover:border-academic-teal/50 transition-all duration-200 rounded-lg text-sm font-medium"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="flex-1 px-3 py-3 bg-gradient-to-r from-academic-teal to-academic-burgundy text-white hover:from-academic-teal/90 hover:to-academic-burgundy/90 shadow-lg hover:shadow-xl transition-all duration-200 rounded-lg text-sm font-medium"
        >
          Start New
        </button>
      </div>
    </div>
  );

  const desktopContent = (
    <div className="text-center">
      <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-gradient-to-r from-academic-burgundy to-academic-rose flex items-center justify-center">
        <RefreshCw className="w-6 h-6 text-white" />
      </div>
      <h2 className="text-lg font-bold bg-gradient-to-r from-academic-burgundy to-academic-rose bg-clip-text text-transparent mb-2 text-center">
          Start New Session
        </h2>
      <p className="text-sm text-muted-foreground leading-relaxed mb-6 text-center">
          This will clear all {selectedMode === 'pdf' ? 'PDF files and chat history' : 'web search conversations'} from your current session.
          <br />
          <span className="text-academic-burgundy font-medium">This action cannot be undone.</span>
        </p>
      <div className="flex gap-3 w-full">
          <button
            onClick={onCancel}
          className="flex-1 px-3 py-3 border-2 border-academic-teal/30 text-academic-teal hover:bg-academic-teal/10 hover:border-academic-teal/50 transition-all duration-200 rounded-lg text-sm font-medium"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
          className="flex-1 px-3 py-3 bg-gradient-to-r from-academic-teal to-academic-burgundy text-white hover:from-academic-teal/90 hover:to-academic-burgundy/90 shadow-lg hover:shadow-xl transition-all duration-200 rounded-lg text-sm font-medium"
          >
            Start New
          </button>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="h-[55vh]">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4" />
              New Session
            </DrawerTitle>
          </DrawerHeader>
          <div className="flex-1 overflow-y-auto p-4">
            {mobileContent}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md border-2 border-academic-burgundy/20 bg-gradient-to-br from-background to-academic-light-rose/5 backdrop-blur-sm">
        <AlertDialogHeader>
          {desktopContent}
        </AlertDialogHeader>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default NewSessionDialog; 