import { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { ModelsPage, OverviewPage, ProjectDetailPage, ProjectsPage, SettingsPage } from "@/pages/studio-pages";
import { AvatarPage, RenderPage, VoicePage } from "@/pages/studio-deliverables";
import { ImagePage, LiveCallPage } from "@/pages/studio-generation";
import { Route, Switch, useLocation, Router as WouterRouter } from "wouter";
import { StudioShell } from "@/components/studio-shell";

const queryClient = new QueryClient();

function Router() {
  return <StudioShell><RoutedErrorBoundary><Switch>
    <Route path="/" component={OverviewPage} />
    <Route path="/projects" component={ProjectsPage} />
    <Route path="/projects/:id" component={ProjectDetailPage} />
    <Route path="/models" component={ModelsPage} />
    <Route path="/voice" component={VoicePage} />
    <Route path="/live" component={LiveCallPage} />
    <Route path="/images" component={ImagePage} />
    <Route path="/avatar" component={AvatarPage} />
    <Route path="/render" component={RenderPage} />
    <Route path="/settings" component={SettingsPage} />
    <Route component={NotFound} />
  </Switch></RoutedErrorBoundary></StudioShell>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;