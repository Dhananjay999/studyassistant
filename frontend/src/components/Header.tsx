import { Button } from "@/components/ui/button";
import { BookOpen, Brain, MessageSquare } from "lucide-react";
import { useState, useEffect } from "react";
import AuthModal from "./AuthModal";

const Header = () => {
  const [isVisible, setIsVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      
      if (currentScrollY > lastScrollY && currentScrollY > 100) {
        // Scrolling down and past initial 100px
        setIsVisible(false);
      } else {
        // Scrolling up
        setIsVisible(true);
      }
      
      setLastScrollY(currentScrollY);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [lastScrollY]);

  return (
    <>
      {/* Spacer div to prevent content jump */}
      <div className="h-14 md:h-16"></div>
      
      <header className={`border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 fixed top-0 left-0 right-0 z-50 transition-transform duration-300 ease-in-out ${
        isVisible ? 'translate-y-0' : '-translate-y-full'
      }`}>
        <div className="container flex h-14 md:h-16 items-center justify-between px-3 md:px-6">
          {/* Logo - Centered on mobile, left on desktop */}
          <div className="flex items-center gap-2 md:gap-3">
            <div className="flex items-center justify-center w-8 h-8 md:w-10 md:h-10 rounded-lg bg-gradient-to-r from-academic-teal to-academic-burgundy">
              <Brain className="w-4 h-4 md:w-6 md:h-6 text-white" />
            </div>
            <div className="md:pt-0 align-center">
              <h1 className="text-lg md:text-xl font-bold text-foreground">StudyAssistant</h1>
              <p className="text-xs text-muted-foreground hidden sm:block">AI Academic Study Assistant</p>
            </div>
          </div>
          
          <nav className="hidden md:flex items-center gap-6">
            <a href="#features" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              Features
            </a>
            <a href="#how-it-works" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              How It Works
            </a>
            <a href="#chat" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              Try Now
            </a>
          </nav>

          <div className="flex items-center gap-2 md:gap-3">
            <Button 
              variant="academic" 
              size="sm" 
              className="text-xs md:text-sm px-3 md:px-4 py-1.5 md:py-2"
              onClick={() => setIsAuthModalOpen(true)}
            >
              Login / Sign Up
            </Button>
          </div>
        </div>
      </header>
      
      <AuthModal 
        isOpen={isAuthModalOpen} 
        onClose={() => setIsAuthModalOpen(false)} 
      />
    </>
  );
};

export default Header;