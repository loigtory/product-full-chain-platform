import { useState, type FormEvent } from 'react';

import type {
  ArtifactReviewConclusion,
  ArtifactReviewDto,
  ArtifactReviewResponsibility,
  CreateArtifactReviewRequest,
} from '@pfc/contracts';
import { ArtifactReviewTimeline, Button } from '@pfc/ui';

export function ArtifactReviewPanel({
  busy,
  currentActorId,
  currentActorName,
  onSubmit,
  reviews,
}: {
  busy: boolean;
  currentActorId: string;
  currentActorName: string;
  onSubmit: (request: CreateArtifactReviewRequest) => Promise<void>;
  reviews: readonly ArtifactReviewDto[];
}) {
  const [conclusion, setConclusion] =
    useState<ArtifactReviewConclusion>('APPROVED');
  const [responsibility, setResponsibility] =
    useState<ArtifactReviewResponsibility>('PRODUCT');
  const [comment, setComment] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit({ conclusion, responsibility, comment });
    setComment('');
  }

  return (
    <div className="artifact-review-panel">
      <form onSubmit={(event) => void submit(event)}>
        <div className="artifact-review-panel__fields">
          <label>
            <span>结论</span>
            <select
              aria-label="评审结论"
              onChange={(event) =>
                setConclusion(event.target.value as ArtifactReviewConclusion)
              }
              value={conclusion}
            >
              <option value="APPROVED">通过</option>
              <option value="CHANGES_REQUESTED">需修改</option>
              <option value="REJECTED">不通过</option>
            </select>
          </label>
          <label>
            <span>责任域</span>
            <select
              aria-label="评审责任域"
              onChange={(event) =>
                setResponsibility(
                  event.target.value as ArtifactReviewResponsibility,
                )
              }
              value={responsibility}
            >
              <option value="PRODUCT">产品</option>
              <option value="DEVELOPMENT">开发</option>
              <option value="CODE_REVIEW">代码评审</option>
              <option value="TEST">测试</option>
              <option value="SECURITY">安全</option>
            </select>
          </label>
        </div>
        <label>
          <span>评审意见</span>
          <textarea
            aria-label="评审意见"
            maxLength={8000}
            onChange={(event) => setComment(event.target.value)}
            rows={3}
            value={comment}
          />
        </label>
        <Button loading={busy} size="sm" type="submit">
          提交评审
        </Button>
      </form>
      <ArtifactReviewTimeline
        items={reviews.map((review) => ({
          id: review.id,
          conclusion: review.conclusion,
          responsibility: review.responsibility,
          comment: review.comment,
          reviewer:
            review.reviewedBy === currentActorId
              ? currentActorName
              : review.reviewedBy,
          createdAt: new Date(review.createdAt).toLocaleString('zh-CN'),
        }))}
      />
    </div>
  );
}
