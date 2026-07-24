<script setup lang="ts">
import folderClosed from '../assets/icons/folder-closed.png'
import folderOpen from '../assets/icons/folder-open.png'

defineProps<{
  open?: boolean
}>()
</script>

<template>
  <span class="folder-tree-icon" aria-hidden="true">
    <img
      class="folder-tree-icon-img"
      :src="open ? folderOpen : folderClosed"
      alt=""
      width="16"
      height="16"
      draggable="false"
    />
  </span>
</template>

<style scoped>
.folder-tree-icon {
  display: inline-flex;
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
}

.folder-tree-icon-img {
  display: block;
  width: 16px;
  height: 16px;
  object-fit: contain;
  pointer-events: none;
  user-select: none;
}
</style>
