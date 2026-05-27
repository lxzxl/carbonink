import { Main } from '@renderer/components/layout/main';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowRight, Download, Upload } from 'lucide-react';

/**
 * `/questionnaires/new` — direction chooser landing page.
 *
 * v2.0 split the previously-one-screen wizard into two flows. Outbound
 * (upload + extract + AI-answer) and inbound (build template + send to
 * supplier + ingest reply) live as separate stacks under
 * `/questionnaires/new/{outbound,inbound}`. This route exists purely to
 * surface that choice to the user.
 *
 * The two cards use the same card primitive shape as the
 * Integrations page so the visual language stays consistent.
 */
export const Route = createFileRoute('/questionnaires/new')({
  component: NewQuestionnaireChooser,
});

interface DirectionCardProps {
  to: '/questionnaires/new/outbound' | '/questionnaires/new/inbound';
  icon: React.ReactNode;
  title: string;
  description: string;
  cta: string;
}

function DirectionCard({ to, icon, title, description, cta }: DirectionCardProps): JSX.Element {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => void navigate({ to })}
      className="group flex flex-col items-start gap-4 rounded-lg border border-border bg-card p-6 text-left transition-colors hover:border-primary/60 hover:bg-muted/30 focus-visible:border-primary focus-visible:outline-none"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
        {icon}
      </div>
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <div className="mt-auto flex items-center gap-1.5 text-sm font-medium text-primary group-hover:gap-2.5 transition-all">
        {cta}
        <ArrowRight className="h-4 w-4" />
      </div>
    </button>
  );
}

function NewQuestionnaireChooser(): JSX.Element {
  return (
    <div className="h-full overflow-auto">
      <Main className="max-w-4xl space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">新建问卷</h1>
          <p className="text-sm text-muted-foreground">
            选择问卷的方向：填写客户发来的问卷（Outbound），或向供应商发问卷收数据（Inbound）。
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <DirectionCard
            to="/questionnaires/new/outbound"
            icon={<Upload className="h-5 w-5" />}
            title="上传客户问卷 / Outbound"
            description="客户、评级机构（CDP、EcoVadis）或采购方尽调发来一份 .xlsx 问卷。系统自动提取问题并用本企业碳排放数据生成答案，最终导回填好的文件。"
            cta="上传 xlsx"
          />
          <DirectionCard
            to="/questionnaires/new/inbound"
            icon={<Download className="h-5 w-5" />}
            title="向供应商收集数据 / Inbound"
            description="向上游供应商发送 Cat 1 标准披露问卷，收回填写后的 xlsx 后自动转换为本企业 Scope 3 库存数据。"
            cta="新建问卷"
          />
        </div>
      </Main>
    </div>
  );
}
