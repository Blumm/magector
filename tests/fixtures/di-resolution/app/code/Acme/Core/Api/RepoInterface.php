<?php
declare(strict_types=1);

namespace Acme\Core\Api;

interface RepoInterface
{
    public function save(string $id): string;
}
