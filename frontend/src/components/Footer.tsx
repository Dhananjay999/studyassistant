import { Button } from "@/components/ui/button";
import { Brain, Mail, Github, Twitter, Linkedin } from "lucide-react";

const Footer = () => {
  return (
    <footer className="bg-academic-teal text-white">
      <div className="container py-16">
        <div className="grid md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-white/10">
                <Brain className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-xl font-bold">StudyMind AI</h3>
                <p className="text-sm opacity-80">Academic Study Assistant</p>
              </div>
            </div>
            <p className="text-sm opacity-80 leading-relaxed">
              Empowering students with AI-powered study assistance. Upload documents, ask questions, and get intelligent answers.
            </p>
          </div>

          {/* Product */}
          <div className="space-y-4">
            <h4 className="font-semibold text-lg">Product</h4>
            <div className="space-y-2 text-sm opacity-80">
              <div><a href="#features" className="hover:opacity-100 transition-opacity">Features</a></div>
              <div><a href="#chat" className="hover:opacity-100 transition-opacity">Try Now</a></div>
              <div><a href="#" className="hover:opacity-100 transition-opacity">Pricing</a></div>
              <div><a href="#" className="hover:opacity-100 transition-opacity">API</a></div>
            </div>
          </div>

          {/* Support */}
          <div className="space-y-4">
            <h4 className="font-semibold text-lg">Support</h4>
            <div className="space-y-2 text-sm opacity-80">
              <div><a href="#" className="hover:opacity-100 transition-opacity">Documentation</a></div>
              <div><a href="#" className="hover:opacity-100 transition-opacity">Help Center</a></div>
              <div><a href="#" className="hover:opacity-100 transition-opacity">Contact Us</a></div>
              <div><a href="#" className="hover:opacity-100 transition-opacity">Status</a></div>
            </div>
          </div>

          {/* Contact */}
          <div className="space-y-4">
            <h4 className="font-semibold text-lg">Stay Connected</h4>
            <p className="text-sm opacity-80">
              Get updates about new features and study tips
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" size="icon" className="bg-white/10 hover:bg-white/20 text-white border-0">
                <Twitter className="w-4 h-4" />
              </Button>
              <Button variant="secondary" size="icon" className="bg-white/10 hover:bg-white/20 text-white border-0">
                <Github className="w-4 h-4" />
              </Button>
              <Button variant="secondary" size="icon" className="bg-white/10 hover:bg-white/20 text-white border-0">
                <Linkedin className="w-4 h-4" />
              </Button>
              <Button variant="secondary" size="icon" className="bg-white/10 hover:bg-white/20 text-white border-0">
                <Mail className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        <div className="border-t border-white/20 mt-12 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-sm opacity-80">
            © 2024 StudyMind AI. All rights reserved.
          </p>
          <div className="flex gap-6 text-sm opacity-80">
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