import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  FileText, 
  Search, 
  Brain, 
  Upload, 
  MessageSquare, 
  Zap,
  Shield,
  Clock,
  BookOpen
} from "lucide-react";

const Features = () => {
  const features = [
    {
      icon: Upload,
      title: "PDF Upload & Analysis",
      description: "Upload multiple PDFs and get instant analysis. Our AI reads and understands your documents to answer specific questions.",
      color: "text-academic-teal"
    },
    {
      icon: Search,
      title: "Web Search Integration",
      description: "Access real-time academic information from the web. Get the latest research and scholarly articles related to your queries.",
      color: "text-academic-burgundy"
    },
    {
      icon: Brain,
      title: "Smart AI Responses",
      description: "Advanced AI that understands context and provides detailed, accurate answers tailored to your academic needs.",
      color: "text-academic-rose"
    },
    {
      icon: MessageSquare,
      title: "Interactive Chat",
      description: "Natural conversation interface that remembers context and allows follow-up questions for deeper understanding.",
      color: "text-academic-teal"
    },
    {
      icon: Zap,
      title: "Instant Results",
      description: "Get answers in seconds, not hours. Our optimized AI processes information quickly to keep your study flow uninterrupted.",
      color: "text-academic-burgundy"
    },
    {
      icon: Shield,
      title: "Secure & Private",
      description: "Your documents and conversations are encrypted and secure. We prioritize your privacy and data protection.",
      color: "text-academic-rose"
    }
  ];

  const stats = [
    { number: "10K+", label: "Students Helped", icon: BookOpen },
    { number: "50K+", label: "Questions Answered", icon: MessageSquare },
    { number: "99.9%", label: "Uptime", icon: Clock },
    { number: "24/7", label: "Available", icon: Zap }
  ];

  return (
    <section id="features" className="py-12 md:py-20 bg-background">
      <div className="container px-3 md:px-6">
        <div className="text-center mb-12 md:mb-16">
          <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold mb-3 md:mb-4">
            Powerful Features for
            <span className="block bg-gradient-to-r from-academic-teal to-academic-burgundy bg-clip-text text-transparent">
              Academic Success
            </span>
          </h2>
          <p className="text-base md:text-xl text-muted-foreground max-w-3xl mx-auto">
            Everything you need to excel in your studies, powered by advanced AI technology
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 mb-12 md:mb-16">
          {stats.map((stat, index) => {
            const IconComponent = stat.icon;
            return (
              <Card key={index} className="text-center border-2 hover:border-academic-rose/50 transition-all duration-300">
                <CardContent className="pt-6">
                  <IconComponent className="w-8 h-8 mx-auto mb-3 text-academic-teal" />
                  <div className="text-2xl md:text-3xl font-bold text-academic-burgundy mb-1">
                    {stat.number}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {stat.label}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
          {features.map((feature, index) => {
            const IconComponent = feature.icon;
            return (
              <Card 
                key={index} 
                className="group hover:shadow-lg transition-all duration-300 hover:-translate-y-1 border-2 hover:border-academic-light-rose"
              >
                <CardHeader>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 rounded-lg bg-gradient-to-br from-academic-light-rose/20 to-academic-rose/20">
                      <IconComponent className={`w-6 h-6 ${feature.color}`} />
                    </div>
                    <CardTitle className="text-lg">{feature.title}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-base leading-relaxed">
                    {feature.description}
                  </CardDescription>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default Features;