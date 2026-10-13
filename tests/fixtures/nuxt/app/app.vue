<script setup lang="ts">
const { url } = useRenditions()
</script>

<template>
  <RenditionImg preset="avatar" src="photo.png" alt="" />
  <a :href="url('avatar', 'photo.png', { density: 2 })">2x</a>
</template>
