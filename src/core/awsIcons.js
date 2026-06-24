/**
 * AWS 아키텍처 아이콘 레지스트리 (다이어그램 모드).
 *
 * 공식 AWS Architecture Icons 일부를 src/assets/aws-icons/ 에 SVG로 번들했다.
 * Vite의 ?raw 글롭으로 빌드 타임에 문자열로 인라인 → 오프라인 동작, 외부 의존 없음.
 * 아이콘은 data URL 이미지로 캔버스에 삽입되므로 기존 image 요소·커넥터와 그대로 호환된다.
 */

// path '../assets/aws-icons/EC2.svg' → raw SVG 문자열
const RAW = import.meta.glob('../assets/aws-icons/*.svg', { query: '?raw', import: 'default', eager: true })

/** raw SVG → <img src>로 쓸 수 있는 data URL (자기완결적, 저장/내보내기 라운드트립 가능) */
export function svgToDataUrl(svg) {
  return 'data:image/svg+xml,' + encodeURIComponent(svg)
}

// 빌드 타임에 1회 인코딩 — 렌더마다 재인코딩하지 않도록 id별 캐시.
const SVG_BY_ID = {}
const DATA_URL_BY_ID = {}
for (const [path, svg] of Object.entries(RAW)) {
  const id = path.split('/').pop().replace(/\.svg$/, '')
  SVG_BY_ID[id] = svg
  DATA_URL_BY_ID[id] = svgToDataUrl(svg)
}

/** 아이콘 id → raw SVG 문자열 (없으면 null) */
export function iconSvg(id) {
  return SVG_BY_ID[id] || null
}

/** 아이콘 id → data URL (없으면 null) — 캐시된 값 반환 */
export function awsIconDataUrl(id) {
  return DATA_URL_BY_ID[id] || null
}

/**
 * 팔레트 카테고리 — 각 아이콘은 { id(파일명), label(표시명) }.
 * id 는 src/assets/aws-icons/<id>.svg 와 1:1.
 */
export const ICON_CATEGORIES = [
  { key: 'compute', label: '컴퓨팅', icons: [
    { id: 'EC2', label: 'EC2' },
    { id: 'Lambda', label: 'Lambda' },
    { id: 'Fargate', label: 'Fargate' },
    { id: 'Elastic-Beanstalk', label: 'Beanstalk' },
    { id: 'Batch', label: 'Batch' },
    { id: 'EC2-Auto-Scaling', label: 'Auto Scaling' },
  ] },
  { key: 'containers', label: '컨테이너', icons: [
    { id: 'Elastic-Container-Service', label: 'ECS' },
    { id: 'Elastic-Kubernetes-Service', label: 'EKS' },
    { id: 'Elastic-Container-Registry', label: 'ECR' },
  ] },
  { key: 'storage', label: '스토리지', icons: [
    { id: 'Simple-Storage-Service', label: 'S3' },
    { id: 'Elastic-Block-Store', label: 'EBS' },
    { id: 'EFS', label: 'EFS' },
    { id: 'Backup', label: 'Backup' },
  ] },
  { key: 'database', label: '데이터베이스', icons: [
    { id: 'RDS', label: 'RDS' },
    { id: 'DynamoDB', label: 'DynamoDB' },
    { id: 'ElastiCache', label: 'ElastiCache' },
    { id: 'Aurora', label: 'Aurora' },
  ] },
  { key: 'networking', label: '네트워킹', icons: [
    { id: 'Virtual-Private-Cloud', label: 'VPC' },
    { id: 'CloudFront', label: 'CloudFront' },
    { id: 'Route-53', label: 'Route 53' },
    { id: 'Elastic-Load-Balancing', label: 'ELB' },
    { id: 'Transit-Gateway', label: 'Transit GW' },
    { id: 'Direct-Connect', label: 'Direct Connect' },
  ] },
  { key: 'integration', label: '통합', icons: [
    { id: 'API-Gateway', label: 'API Gateway' },
    { id: 'Simple-Queue-Service', label: 'SQS' },
    { id: 'Simple-Notification-Service', label: 'SNS' },
    { id: 'EventBridge', label: 'EventBridge' },
    { id: 'Step-Functions', label: 'Step Functions' },
  ] },
  { key: 'security', label: '보안', icons: [
    { id: 'Identity-and-Access-Management', label: 'IAM' },
    { id: 'Cognito', label: 'Cognito' },
    { id: 'Secrets-Manager', label: 'Secrets Mgr' },
    { id: 'WAF', label: 'WAF' },
    { id: 'Key-Management-Service', label: 'KMS' },
  ] },
  { key: 'management', label: '관리', icons: [
    { id: 'CloudWatch', label: 'CloudWatch' },
    { id: 'CloudFormation', label: 'CloudFormation' },
    { id: 'CloudTrail', label: 'CloudTrail' },
    { id: 'Systems-Manager', label: 'Systems Mgr' },
  ] },
  { key: 'analytics', label: '분석', icons: [
    { id: 'Kinesis', label: 'Kinesis' },
    { id: 'Athena', label: 'Athena' },
    { id: 'Glue', label: 'Glue' },
    { id: 'EMR', label: 'EMR' },
    { id: 'QuickSight', label: 'QuickSight' },
    { id: 'Redshift', label: 'Redshift' },
  ] },
  { key: 'ml', label: '머신러닝', icons: [
    { id: 'SageMaker', label: 'SageMaker' },
    { id: 'Rekognition', label: 'Rekognition' },
  ] },
  { key: 'frontend', label: '프런트엔드', icons: [
    { id: 'Amplify', label: 'Amplify' },
  ] },
]

/** id → label 역참조 (삽입 시 기본 라벨 텍스트로 사용) */
export const ICON_LABEL = {}
for (const cat of ICON_CATEGORIES) {
  for (const ic of cat.icons) ICON_LABEL[ic.id] = ic.label
}

/**
 * 그룹 컨테이너 — AWS 다이어그램 특유의 경계 박스(점선/실선 테두리 + 좌상단 라벨).
 * 아이콘이 아니라 색 입힌 사각형으로, 도형 요소로 삽입한다. 색은 AWS 공식 그룹 팔레트 근사.
 */
export const GROUP_CONTAINERS = [
  { kind: 'aws-cloud', label: 'AWS Cloud', color: '#232F3E', dashed: false },
  { kind: 'region', label: 'Region', color: '#00A4A6', dashed: true },
  { kind: 'vpc', label: 'VPC', color: '#8C4FFF', dashed: false },
  { kind: 'az', label: 'Availability Zone', color: '#00A4A6', dashed: true },
  { kind: 'public-subnet', label: 'Public subnet', color: '#7AA116', dashed: false },
  { kind: 'private-subnet', label: 'Private subnet', color: '#00A4A6', dashed: false },
  { kind: 'asg', label: 'Auto Scaling group', color: '#ED7100', dashed: true },
]

export const GROUP_BY_KIND = {}
for (const g of GROUP_CONTAINERS) GROUP_BY_KIND[g.kind] = g

/** 드래그 데이터 MIME 타입 (캔버스 드롭 핸들러와 공유) */
export const AWS_ICON_MIME = 'application/x-aws-icon'
export const AWS_GROUP_MIME = 'application/x-aws-group'
