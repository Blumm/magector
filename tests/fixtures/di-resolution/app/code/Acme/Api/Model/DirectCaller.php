<?php
declare(strict_types=1);

namespace Acme\Api\Model;

class DirectCaller
{
    public function __construct(private readonly \Acme\Core\Api\RepoInterface $repository)
    {
    }

    public function execute(): string
    {
        return $this->repository->save('direct');
    }
}
