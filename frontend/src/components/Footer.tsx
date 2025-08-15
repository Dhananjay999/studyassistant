import { Button } from "@/components/ui/button";
import { Brain, Mail, Github, Twitter, Linkedin } from "lucide-react";

const Footer = () => {
  return (
    <footer className="bg-academic-teal text-white">
      <div className="container py-8 md:py-16">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">
          {/* Brand */}
          <div className="space-y-3 md:space-y-4 col-span-2 md:col-span-1">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-8 h-8 md:w-10 md:h-10 rounded-lg bg-white/10">
                <Brain className="w-5 h-5 md:w-6 md:h-6" />
              </div>
              <div>
                <h3 className="text-lg md:text-xl font-bold">StudyMind AI</h3>
                <p className="text-xs md:text-sm opacity-80">Academic Study Assistant</p>
              </div>
            </div>
            <p className="text-xs md:text-sm opacity-80 leading-relaxed">
              Empowering students with AI-powered study assistance. Upload documents, ask questions, and get intelligent answers.
            </p>
          </div>

          {/* Product */}
          <div className="space-y-3 md:space-y-4">
            <h4 className="font-semibold text-base md:text-lg">Product</h4>
            <div className="space-y-1.5 md:space-y-2 text-xs md:text-sm opacity-80">
              <div><a href="#features" className="hover:opacity-100 transition-opacity">Features</a></div>
              <div><a href="#chat" className="hover:opacity-100 transition-opacity">Try Now</a></div>
              <div><a href="#" className="hover:opacity-100 transition-opacity">Pricing</a></div>
              <div><a href="#" className="hover:opacity-100 transition-opacity">API</a></div>
            </div>
          </div>

          {/* Support */}
          <div className="space-y-3 md:space-y-4">
            <h4 className="font-semibold text-base md:text-lg">Support</h4>
            <div className="space-y-1.5 md:space-y-2 text-xs md:text-sm opacity-80">
              <div><a href="#" className="hover:opacity-100 transition-opacity">Documentation</a></div>
              <div><a href="#" className="hover:opacity-100 transition-opacity">Help Center</a></div>
              <div><a href="#" className="hover:opacity-100 transition-opacity">Contact Us</a></div>
              <div><a href="#" className="hover:opacity-100 transition-opacity">Status</a></div>
            </div>
          </div>

          {/* Contact */}
          <div className="space-y-3 md:space-y-4 col-span-2 md:col-span-1">
            <h4 className="font-semibold text-base md:text-lg">Stay Connected</h4>
            <p className="text-xs md:text-sm opacity-80">
              Get updates about new features and study tips
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" size="icon" className="bg-white/10 hover:bg-white/20 text-white border-0 h-8 w-8 md:h-10 md:w-10">
                <Twitter className="w-3 h-3 md:w-4 md:h-4" />
              </Button>
              <Button variant="secondary" size="icon" className="bg-white/10 hover:bg-white/20 text-white border-0 h-8 w-8 md:h-10 md:w-10">
                <Github className="w-3 h-3 md:w-4 md:h-4" />
              </Button>
              <Button variant="secondary" size="icon" className="bg-white/10 hover:bg-white/20 text-white border-0 h-8 w-8 md:h-10 md:w-10">
                <Linkedin className="w-3 h-3 md:w-4 md:h-4" />
              </Button>
              <Button variant="secondary" size="icon" className="bg-white/10 hover:bg-white/20 text-white border-0 h-8 w-8 md:h-10 md:w-10">
                <Mail className="w-3 h-3 md:w-4 md:h-4" />
              </Button>
            </div>
          </div>
        </div>

        <div className="border-t border-white/20 mt-8 md:mt-12 pt-6 md:pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-xs md:text-sm opacity-80 text-center md:text-left">
            © 2024 StudyMind AI. All rights reserved.
          </p>
          <div className="flex flex-wrap justify-center gap-4 md:gap-6 text-xs md:text-sm opacity-80">
            <a href="#" className="hover:opacity-100 transition-opacity">Privacy Policy</a>
            <a href="#" className="hover:opacity-100 transition-opacity">Terms of Service</a>
            <a href="#" className="hover:opacity-100 transition-opacity">Cookie Policy</a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;