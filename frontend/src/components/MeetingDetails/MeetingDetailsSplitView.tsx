'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { FileText, NotebookPen, Sparkles } from 'lucide-react';
import { usePaneResize, writeStoredValue } from '@/hooks/usePaneResize';
import { PaneResizeHandle } from '@/components/PaneResizeHandle';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
const STORAGE_KEY = 'meetily.meetingDetails.transcriptPaneRatio';
const DEFAULT_RATIO = 0.3;
const MIN_RATIO = 0.3;
const MAX_RATIO = 0.5;

const TABS = [
  { value: 'transcript' as const, label: 'Transcript', icon: FileText },
  { value: 'summary' as const, label: 'Summary', icon: Sparkles },
  { value: 'notes' as const, label: 'Notes', icon: NotebookPen },
];
const RIGHT_PANES = TABS.filter((tab) => tab.value !== 'transcript');

export type MeetingDetailsTab = 'transcript' | 'summary' | 'notes';
export type MeetingDetailsRightPane = Exclude<MeetingDetailsTab, 'transcript'>;

/** On wide windows the transcript is always visible; this picks what sits beside it. */
export function resolveRightPane(
  activeTab: MeetingDetailsTab,
  lastRightPane: MeetingDetailsRightPane,
): MeetingDetailsRightPane {
  return activeTab === 'transcript' ? lastRightPane : activeTab;
}

interface MeetingDetailsSplitViewProps {
  transcript: ReactNode;
  summary: ReactNode;
  notes: ReactNode;
  activeTab: MeetingDetailsTab;
  onTabChange: (tab: MeetingDetailsTab) => void;
}

export function MeetingDetailsSplitView({
  transcript,
  summary,
  notes,
  activeTab,
  onTabChange,
}: MeetingDetailsSplitViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [collapsed,setCollapsed]=useState(false);
  const setTranscriptCollapsed=(value:boolean)=>{setCollapsed(value);writeStoredValue('meetily.meetingDetails.transcriptPaneCollapsed',value?'1':'0');};
  const resize=usePaneResize({storageKey:STORAGE_KEY,defaultValue:DEFAULT_RATIO,min:MIN_RATIO,max:MAX_RATIO,step:0.05,valueFromPointer:clientX=>{const rect=containerRef.current?.getBoundingClientRect();return rect&&rect.width>0?(clientX-rect.left)/rect.width:null;},collapseBelow:0.15,onCollapse:()=>setTranscriptCollapsed(true)});
  const ratio=resize.value;
  const [isDesktop, setIsDesktop] = useState(true);
  const [lastRightPane, setLastRightPane] = useState<MeetingDetailsRightPane>('summary');
  useEffect(() => {
    if (activeTab !== 'transcript') setLastRightPane(activeTab);
  }, [activeTab]);
  const rightPane = resolveRightPane(activeTab, lastRightPane);
  const [notesShown, setNotesShown] = useState(false);
  useEffect(() => {
    if (activeTab === 'notes') setNotesShown(true);
  }, [activeTab]);
  const notesMounted = notesShown || activeTab === 'notes';

  useEffect(()=>{try{setCollapsed(window.localStorage.getItem('meetily.meetingDetails.transcriptPaneCollapsed')==='1');}catch{}},[]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 768px)');
    const updateLayout = () => setIsDesktop(mediaQuery.matches);
    updateLayout();
    mediaQuery.addEventListener('change', updateLayout);
    return () => mediaQuery.removeEventListener('change', updateLayout);
  }, []);

  const transcriptPanelProps = isDesktop
    ? { role: 'region' as const, 'aria-label': 'Transcript', tabIndex: -1 }
    : {};
  const summaryPanelProps = isDesktop
    ? { role: 'region' as const, 'aria-label': 'Summary', tabIndex: -1 }
    : {};
  const notesPanelProps = isDesktop
    ? { role: 'region' as const, 'aria-label': 'Notes', tabIndex: -1 }
    : {};
  const rightPanelClass =
    'mt-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden';

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => onTabChange(value as MeetingDetailsTab)}
      className="flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden"
    >
      <div className="shrink-0 bg-white px-2 md:hidden">
        <TabsList className="relative h-auto w-full justify-center rounded-none border-b border-gray-200 bg-transparent p-0">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="relative z-10 flex items-center gap-2 rounded-none border-0 bg-transparent px-6 py-4 text-gray-600 data-[state=active]:bg-transparent data-[state=active]:text-blue-600 data-[state=active]:shadow-none hover:text-gray-900"
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </div>
      <div
        ref={containerRef}
        className="flex flex-1 min-h-0 min-w-0 flex-col md:flex-row"
        style={{ '--transcript-pane-width': `${ratio * 100}%` } as CSSProperties}
      >
        <TabsContent
          value="transcript"
          style={isDesktop&&collapsed?{display:'none'}:undefined}
          forceMount
          className="mt-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden md:w-[var(--transcript-pane-width)] md:flex-none md:data-[state=inactive]:flex"
          {...transcriptPanelProps}
        >
          {transcript}
        </TabsContent>
        {(!isDesktop||!collapsed)&&<PaneResizeHandle handleProps={resize.handleProps} label={rightPane==='notes'?'Resize transcript and notes':'Resize transcript and summary'} valueNow={Math.round(ratio*100)} valueMin={30} valueMax={50} valueText={`Transcript panel ${Math.round(ratio*100)} percent`} className="relative hidden md:flex"/>}
        <div
          className={`${activeTab === 'transcript' ? 'hidden md:flex' : 'flex'} min-h-0 min-w-0 flex-1 flex-col overflow-hidden`}
        >
          <div
            role="group"
            aria-label="Summary or notes"
            className="hidden shrink-0 items-center justify-center gap-1 border-b border-gray-200 bg-white px-2 py-1.5 md:flex"
          >
            <button type="button" className="rounded px-3 py-1 text-sm hover:bg-gray-100" aria-expanded={!collapsed} onClick={()=>setTranscriptCollapsed(!collapsed)}>{collapsed?'Show transcript':'Hide transcript'}</button>
            {RIGHT_PANES.map((pane) => {
              const Icon = pane.icon;
              const selected = rightPane === pane.value;
              return (
                <button
                  key={pane.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onTabChange(pane.value)}
                  className={`flex items-center gap-2 rounded-md px-3 py-1 text-sm ${
                    selected ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {pane.label}
                </button>
              );
            })}
          </div>
          <TabsContent
            value="summary"
            forceMount
            className={`${rightPanelClass} ${rightPane === 'summary' ? 'md:data-[state=inactive]:flex' : ''}`}
            {...summaryPanelProps}
          >
            {summary}
          </TabsContent>
          <TabsContent
            value="notes"
            forceMount
            className={`${rightPanelClass} ${rightPane === 'notes' ? 'md:data-[state=inactive]:flex' : ''}`}
            {...notesPanelProps}
          >
            {notesMounted ? notes : null}
          </TabsContent>
        </div>
      </div>
    </Tabs>
  );
}
