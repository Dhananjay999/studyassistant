import { Button } from "@/components/ui/button";
import { BookOpen, Brain, MessageSquare } from "lucide-react";

const Header = () => {
  return (
    <header className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
      <div className="container flex h-16 items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-gradient-to-r from-academic-teal to-academic-burgundy">
            <Brain className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">StudyAssistant</h1>
            <p className="text-xs text-muted-foreground">AI Academic Study Assistant</p>
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

        <div className="flex items-center gap-3">
          <Button variant="academicOutline" size="sm">
            Sign In
          </Button>
          <Button variant="academic" size="sm">
            Get Started
          </Button>
        </div>
      </div>
    </header>
  );
};

export default Header;