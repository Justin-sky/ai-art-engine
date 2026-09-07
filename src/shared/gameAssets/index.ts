/**
 * 2D 游戏资产（5.4「2D 游戏资产版」）共享纯函数层。
 *
 * 统一对齐几何与 sprite manifest 是所有引擎就绪资产生成链路
 * （角色差分 / 特效 sheet / 骨骼拆件 / UI 部件）的共用地基；
 * stage2dScene 是 5.5「2D 导演台」2D 舞台层的共享状态与放置几何，
 * stage2dRig 是同节「骨骼装配与摆姿」的骨骼层级 / attach 槽 / FK 地基，
 * stage2dAction 是「动作与循环预览」的 pose 关键帧插值循环纯函数层。
 */
export * from './spriteGeometry'
export * from './spriteManifest'
export * from './stage2dScene'
export * from './stage2dRig'
export * from './stage2dPoseSolve'
export * from './stage2dHumanoid'
export * from './stage2dAction'
export * from './stage2dActionPresets'
export * from './stage2dActionAsset'
