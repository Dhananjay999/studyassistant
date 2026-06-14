# Chat Component Architecture

## Overview

This document describes the enhanced chat component architecture that provides both collapsed and full-screen views with a modern, responsive design inspired by contemporary chat applications.

## Component Structure

### Main Components

#### 1. ChatPage (`src/pages/ChatPage.tsx`)
- **Purpose**: Full-screen chat interface with split-panel layout
- **Features**: 
  - Sources panel (left sidebar)
  - Chat panel (right main area)
  - Collapsible sources panel
  - Modern navigation bar
  - Responsive design

#### 2. ChatInterface (`src/components/ChatInterface.tsx`)
- **Purpose**: Embedded chat component for the main page
- **Features**:
  - Compact design
  - Full-screen toggle button
  - PDF viewer integration
  - File upload functionality

### Sub-Components

#### 1. SourcesPanel (`src/components/chat/SourcesPanel.tsx`)
- **Purpose**: Manages document sources and file uploads
- **Features**:
  - File upload interface
  - File list with preview
  - Delete functionality
  - Source selection

#### 2. ChatHeader (`src/components/chat/ChatHeader.tsx`)
- **Purpose**: Chat mode selection and user authentication status
- **Features**:
  - Mode tabs (PDF/Web)
  - User authentication display
  - Login prompt banner

#### 3. ChatMessages (`src/components/chat/ChatMessages.tsx`)
- **Purpose**: Displays conversation messages
- **Features**:
  - Message bubbles with avatars
  - Markdown rendering
  - Action buttons (save, copy, share)
  - Advanced actions (notes, audio, mind map)
  - Loading indicators

#### 4. ChatInput (`src/components/chat/ChatInput.tsx`)
- **Purpose**: Message input with suggestions
- **Features**:
  - Text input with file upload
  - Suggested questions
  - Attachment handling
  - Send button with loading state

## Design Features

### Modern Aesthetic
- **Dark/Light Theme Support**: Seamless theme switching
- **Glass Morphism**: Subtle backdrop blur effects
- **Gradient Accents**: Academic color scheme
- **Smooth Animations**: CSS transitions and micro-interactions

### Responsive Design
- **Mobile-First**: Optimized for all screen sizes
- **Adaptive Layout**: Sources panel collapses on smaller screens
- **Touch-Friendly**: Large touch targets and gestures

### User Experience
- **Intuitive Navigation**: Clear visual hierarchy
- **Contextual Actions**: Relevant buttons for each message
- **Progressive Disclosure**: Information revealed as needed
- **Accessibility**: Keyboard navigation and screen reader support

## Usage

### Basic Implementation

```tsx
import ChatPage from './pages/ChatPage';

// In your router
<Route path="/chat" element={<ChatPage />} />
```

### Navigation

```tsx
import { useNavigate } from 'react-router-dom';

const navigate = useNavigate();
navigate('/chat'); // Navigate to full-screen chat
```

### Customization

#### Styling
The components use Tailwind CSS with custom CSS variables for theming:

```css
:root {
  --academic-teal: 173 58% 39%;
  --academic-burgundy: 197 37% 24%;
  --academic-rose: 12 76% 61%;
  --academic-light-rose: 43 74% 66%;
}
```

#### Props Interface

```tsx
interface ChatPageProps {
  // All props are internal to the component
}

interface SourcesPanelProps {
  selectedMode: 'pdf' | 'web';
  onModeChange: (mode: 'pdf' | 'web') => void;
  attachedFiles: File[];
  uploadedFileNames: string[];
  currentPDF: File | null;
  onFileUpload: (files: File[]) => void;
  onFileDelete: (fileName: string) => void;
  onPDFSelect: (file: File | null) => void;
  onPDFViewerToggle: (show: boolean) => void;
  showPDFViewer: boolean;
  chatModes: ChatMode[];
}
```

## State Management

### Local State
- Message history
- File attachments
- Loading states
- UI interactions

### API Integration
- File upload/download
- Chat message sending
- Authentication status
- User preferences

## File Structure

```
src/
├── pages/
│   └── ChatPage.tsx              # Full-screen chat page
├── components/
│   ├── ChatInterface.tsx         # Embedded chat component
│   └── chat/
│       ├── SourcesPanel.tsx      # Sources management
│       ├── ChatHeader.tsx        # Header with tabs
│       ├── ChatMessages.tsx      # Message display
│       └── ChatInput.tsx         # Input with suggestions
├── types/
│   └── chat.ts                   # TypeScript interfaces
└── services/
    └── api.ts                    # API service functions
```

## Features

### Core Functionality
- ✅ Full-screen chat interface
- ✅ Collapsible sources panel
- ✅ PDF file upload and management
- ✅ Web search integration
- ✅ Message history
- ✅ File attachments
- ✅ Markdown rendering
- ✅ Loading states

### Advanced Features
- ✅ Suggested questions
- ✅ Message actions (save, copy, share)
- ✅ Advanced actions (notes, audio, mind map)
- ✅ Source tracking
- ✅ Authentication integration
- ✅ Responsive design
- ✅ Dark/light theme support

### UX Enhancements
- ✅ Smooth animations
- ✅ Hover effects
- ✅ Focus management
- ✅ Keyboard shortcuts
- ✅ Touch gestures
- ✅ Accessibility features

## Future Enhancements

### Planned Features
- [ ] Real-time collaboration
- [ ] Voice input/output
- [ ] Advanced file preview
- [ ] Chat history search
- [ ] Export functionality
- [ ] Custom themes
- [ ] Plugin system

### Performance Optimizations
- [ ] Virtual scrolling for large message lists
- [ ] Lazy loading for file previews
- [ ] Message caching
- [ ] Optimistic updates

## Contributing

When contributing to the chat components:

1. **Follow the existing patterns** for component structure
2. **Use TypeScript** for all new components
3. **Add proper JSDoc comments** for public APIs
4. **Test responsive behavior** on multiple screen sizes
5. **Ensure accessibility** compliance
6. **Update this documentation** for any architectural changes

## Troubleshooting

### Common Issues

1. **Messages not sending**: Check API service configuration
2. **File upload failing**: Verify file size limits and type restrictions
3. **Styling issues**: Ensure Tailwind CSS is properly configured
4. **Navigation problems**: Check React Router setup

### Debug Mode

Enable debug logging by setting the environment variable:
```bash
REACT_APP_DEBUG_CHAT=true
```

This will log detailed information about component state and API calls.
